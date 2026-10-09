import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { AdjustStockDto } from './dto/adjust-stock.dto';

const NEGATIVE_STOCK = 'NEGATIVE_STOCK';

export type StockMovementType =
    | 'SALE'
    | 'RESTOCK'
    | 'ADJUSTMENT'
    | 'RETURN'
    | 'TRANSFER_OUT'
    | 'TRANSFER_IN';

export interface MovementInput {
    branchId: string;
    productId: string;
    type: StockMovementType;
    qtyDelta: number;
    refType?: string;
    refId?: string;
    reason?: string;
    createdBy?: string;
}

/** A low-stock threshold was crossed (qty moved from above to at/below it). */
export interface ThresholdCrossing {
    branchId: string;
    productId: string;
    qty: number;
    lowStockThreshold: number;
}

/**
 * Minimal transaction-client shape the stock writes need. Callers (e.g. sales)
 * pass their own transaction so stock changes commit atomically with the action.
 */
type StockTx = {
    stockMovement: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
    branchStock: {
        findUnique(args: {
            where: { branchId_productId: { branchId: string; productId: string } };
        }): Promise<{ qty: number; lowStockThreshold: number; flags: string[] } | null>;
        upsert(args: {
            where: { branchId_productId: { branchId: string; productId: string } };
            create: Record<string, unknown>;
            update: Record<string, unknown>;
        }): Promise<{ qty: number; lowStockThreshold: number; flags: string[] }>;
        update(args: {
            where: { branchId_productId: { branchId: string; productId: string } };
            data: Record<string, unknown>;
        }): Promise<unknown>;
    };
};

@Injectable()
export class StockService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    /**
     * Apply stock movements inside the caller's transaction. For each movement:
     * insert an immutable ledger row, then atomically adjust the cached
     * branch_stock quantity (qty = qty + delta). Never blocks on negative stock;
     * it flags it instead. Returns any low-stock threshold crossings so the
     * caller can enqueue alerts after commit.
     *
     * This is the ONLY write path for stock tables. No other module writes them.
     */
    async apply(tx: StockTx, movements: MovementInput[]): Promise<ThresholdCrossing[]> {
        const crossings: ThresholdCrossing[] = [];

        for (const m of movements) {
            await tx.stockMovement.create({
                data: {
                    branchId: m.branchId,
                    productId: m.productId,
                    type: m.type,
                    qtyDelta: m.qtyDelta,
                    refType: m.refType ?? null,
                    refId: m.refId ?? null,
                    reason: m.reason ?? null,
                    createdBy: m.createdBy ?? null,
                },
            });

            const before = await tx.branchStock.findUnique({
                where: { branchId_productId: { branchId: m.branchId, productId: m.productId } },
            });
            const beforeQty = before?.qty ?? 0;
            const threshold = before?.lowStockThreshold ?? 0;

            // Atomic increment; upsert so the first movement for a product creates the row.
            const after = await tx.branchStock.upsert({
                where: { branchId_productId: { branchId: m.branchId, productId: m.productId } },
                create: { branchId: m.branchId, productId: m.productId, qty: m.qtyDelta },
                update: { qty: { increment: m.qtyDelta } },
            });

            // Maintain the negative-stock flag based on the resulting quantity.
            const flags = new Set(after.flags ?? []);
            if (after.qty < 0) flags.add(NEGATIVE_STOCK);
            else flags.delete(NEGATIVE_STOCK);
            await tx.branchStock.update({
                where: { branchId_productId: { branchId: m.branchId, productId: m.productId } },
                data: { flags: Array.from(flags) },
            });

            // Threshold crossing: was above, now at-or-below (and a threshold is set).
            if (threshold > 0 && beforeQty > threshold && after.qty <= threshold) {
                crossings.push({
                    branchId: m.branchId,
                    productId: m.productId,
                    qty: after.qty,
                    lowStockThreshold: threshold,
                });
            }
        }

        return crossings;
    }

    /**
     * Manual restock or adjustment with a required reason. Runs its own
     * transaction, applies the movement, and writes an audit entry.
     */
    private async assertBranchInOrg(tenant: TenantContext, branchId: string): Promise<void> {
        const branch = await this.prisma.branch.findFirst({
            where: { id: branchId, organizationId: tenant.organizationId },
            select: { id: true },
        });
        if (!branch) {
            throw new NotFoundException('Branch not found');
        }
    }

    async adjust(tenant: TenantContext, dto: AdjustStockDto): Promise<ThresholdCrossing[]> {
        // Branch and product must belong to the caller's organization (tenant isolation).
        await this.assertBranchInOrg(tenant, dto.branchId);
        const product = await this.prisma.product.findFirst({
            where: { id: dto.productId, organizationId: tenant.organizationId },
            select: { id: true },
        });
        if (!product) {
            throw new NotFoundException('Product not found');
        }

        return this.prisma.$transaction(async (tx) => {
            const crossings = await this.apply(tx as unknown as StockTx, [
                {
                    branchId: dto.branchId,
                    productId: dto.productId,
                    type: dto.type,
                    qtyDelta: dto.qtyDelta,
                    refType: 'adjustment',
                    reason: dto.reason,
                    createdBy: tenant.userId,
                },
            ]);

            await this.audit.record(tx, {
                organizationId: tenant.organizationId,
                actorId: tenant.userId,
                action: 'stock.adjusted',
                entity: 'BranchStock',
                entityId: `${dto.branchId}:${dto.productId}`,
                after: { type: dto.type, qtyDelta: dto.qtyDelta, reason: dto.reason },
            });

            return crossings;
        });
    }

    /**
     * Set the low-stock threshold for a product at a branch. Creates the
     * branch_stock row (qty 0) if it does not exist yet. Threshold is per-branch
     * because the same product can have different reorder points per location.
     */
    async setThreshold(
        tenant: TenantContext,
        branchId: string,
        productId: string,
        lowStockThreshold: number,
    ) {
        await this.assertBranchInOrg(tenant, branchId);
        const product = await this.prisma.product.findFirst({
            where: { id: productId, organizationId: tenant.organizationId },
            select: { id: true },
        });
        if (!product) {
            throw new NotFoundException('Product not found');
        }

        return this.prisma.branchStock.upsert({
            where: { branchId_productId: { branchId, productId } },
            create: { branchId, productId, qty: 0, lowStockThreshold },
            update: { lowStockThreshold },
        });
    }

    /** Stock rows for a branch (scoped to the caller's organization). */
    async getBranchStock(tenant: TenantContext, branchId: string) {
        await this.assertBranchInOrg(tenant, branchId);
        return this.prisma.branchStock.findMany({
            where: { branchId },
            orderBy: { productId: 'asc' },
        });
    }

    /** Items at or below their low-stock threshold (threshold > 0). */
    async getLowStock(tenant: TenantContext, branchId: string) {
        await this.assertBranchInOrg(tenant, branchId);
        const rows = await this.prisma.branchStock.findMany({ where: { branchId } });
        return rows.filter((r) => r.lowStockThreshold > 0 && r.qty <= r.lowStockThreshold);
    }

    /**
     * Recompute the cached quantity for a branch from the ledger and report
     * drift. The repair tool for suspected cache/ledger divergence.
     */
    async rebuild(branchId: string): Promise<{ productId: string; cached: number; ledger: number }[]> {
        const sums = await this.prisma.stockMovement.groupBy({
            by: ['productId'],
            where: { branchId },
            _sum: { qtyDelta: true },
        });

        const drift: { productId: string; cached: number; ledger: number }[] = [];
        for (const s of sums) {
            const ledger = s._sum.qtyDelta ?? 0;
            const current = await this.prisma.branchStock.findUnique({
                where: { branchId_productId: { branchId, productId: s.productId } },
            });
            const cached = current?.qty ?? 0;
            if (cached !== ledger) {
                drift.push({ productId: s.productId, cached, ledger });
                await this.prisma.branchStock.update({
                    where: { branchId_productId: { branchId, productId: s.productId } },
                    data: { qty: ledger },
                });
            }
        }
        return drift;
    }
}
