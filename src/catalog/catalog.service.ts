import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../tenancy/tenant.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { buildPage, clampLimit, decodeCursor, Page, PageQuery } from '../common/pagination';

type Product = {
    id: string;
    organizationId: string;
    name: string;
    sku: string | null;
    barcode: string | null;
    unit: string | null;
    price: number;
    cost: number;
    active: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
};

@Injectable()
export class CatalogService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async create(tenant: TenantContext, dto: CreateProductDto): Promise<Product> {
        return this.prisma.$transaction(async (tx) => {
            const product = await tx.product.create({
                data: {
                    organizationId: tenant.organizationId,
                    name: dto.name,
                    sku: dto.sku ?? null,
                    barcode: dto.barcode ?? null,
                    unit: dto.unit ?? null,
                    price: dto.price,
                    cost: dto.cost,
                },
            });

            await this.audit.record(tx, {
                organizationId: tenant.organizationId,
                actorId: tenant.userId,
                action: 'product.created',
                entity: 'Product',
                entityId: product.id,
                after: product,
            });

            return product as Product;
        });
    }

    async list(tenant: TenantContext, query: PageQuery): Promise<Page<Product>> {
        const limit = clampLimit(query.limit);
        const cursorId = decodeCursor(query.cursor);

        const rows = await this.prisma.product.findMany({
            where: { organizationId: tenant.organizationId },
            orderBy: { id: 'asc' },
            take: limit + 1,
            ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        });

        return buildPage(rows as Product[], limit);
    }

    async get(tenant: TenantContext, id: string): Promise<Product> {
        // Scoped by organizationId so a valid id from another tenant is a 404, not a leak.
        const product = await this.prisma.product.findFirst({
            where: { id, organizationId: tenant.organizationId },
        });
        if (!product) {
            throw new NotFoundException('Product not found');
        }
        return product as Product;
    }

    async update(tenant: TenantContext, id: string, dto: UpdateProductDto): Promise<Product> {
        return this.prisma.$transaction(async (tx) => {
            const before = await tx.product.findFirst({
                where: { id, organizationId: tenant.organizationId },
            });
            if (!before) {
                throw new NotFoundException('Product not found');
            }

            const after = await tx.product.update({
                where: { id },
                data: {
                    ...(dto.name !== undefined ? { name: dto.name } : {}),
                    ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
                    ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
                    ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
                    ...(dto.price !== undefined ? { price: dto.price } : {}),
                    ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
                    ...(dto.active !== undefined ? { active: dto.active } : {}),
                    // Every edit bumps version so sync can detect stale/last-write-wins edits.
                    version: { increment: 1 },
                },
            });

            // Price/cost changes are a tracked, audited event (invariant).
            const priceOrCostChanged =
                (dto.price !== undefined && dto.price !== before.price) ||
                (dto.cost !== undefined && dto.cost !== before.cost);

            await this.audit.record(tx, {
                organizationId: tenant.organizationId,
                actorId: tenant.userId,
                action: priceOrCostChanged ? 'product.price_changed' : 'product.updated',
                entity: 'Product',
                entityId: id,
                before,
                after,
            });

            return after as Product;
        });
    }

    /** Soft retirement: products are deactivated, never deleted. */
    async deactivate(tenant: TenantContext, id: string): Promise<Product> {
        return this.prisma.$transaction(async (tx) => {
            const before = await tx.product.findFirst({
                where: { id, organizationId: tenant.organizationId },
            });
            if (!before) {
                throw new NotFoundException('Product not found');
            }

            const after = await tx.product.update({
                where: { id },
                data: { active: false, version: { increment: 1 } },
            });

            await this.audit.record(tx, {
                organizationId: tenant.organizationId,
                actorId: tenant.userId,
                action: 'product.deactivated',
                entity: 'Product',
                entityId: id,
                before,
                after,
            });

            return after as Product;
        });
    }
}
