import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { StockService, type MovementInput } from '../inventory/stock.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { AllocatePaymentDto } from './dto/allocate-payment.dto';

function varianceTolerance(): bigint {
    const raw = process.env.SALE_VARIANCE_TOLERANCE;
    try {
        return raw ? BigInt(raw) : 0n;
    } catch {
        return 0n;
    }
}

@Injectable()
export class SalesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly outbox: OutboxService,
        private readonly stock: StockService,
    ) {}

    /**
     * Allocate a confirmed payment to the items that were sold: one atomic
     * transaction that creates the sale + items (price/cost snapshots), claims
     * the payment (unique allocation), decrements stock through the ledger, and
     * writes the audit entry and outbox events. Never blocks on negative stock
     * or on a payment/item variance — both are recorded and flagged.
     */
    async allocate(tenant: TenantContext, paymentId: string, dto: AllocatePaymentDto) {
        // Idempotency: a replay with the same key returns the original sale.
        const existing = await this.findByIdempotencyKey(tenant.organizationId, dto.idempotencyKey);
        if (existing) return this.toResponse(existing);

        const payment = await this.prisma.payment.findFirst({
            where: { id: paymentId, organizationId: tenant.organizationId },
        });
        if (!payment) throw new NotFoundException('Payment not found');
        if (payment.status !== 'SUCCEEDED') {
            throw new ConflictException('Payment is not in a confirmed state');
        }

        const branchId = await this.resolveBranchId(tenant, payment.branchId);

        // Snapshot active products in this org.
        const productIds = [...new Set(dto.items.map((i) => i.productId))];
        const products = await this.prisma.product.findMany({
            where: { id: { in: productIds }, organizationId: tenant.organizationId, active: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        if (byId.size !== productIds.length) {
            throw new BadRequestException('One or more products are unknown or inactive');
        }

        const lines = dto.items.map((i) => {
            const p = byId.get(i.productId)!;
            return { productId: p.id, qty: i.qty, unitPrice: p.price, unitCost: p.cost };
        });

        let total = 0n;
        let margin = 0n;
        for (const l of lines) {
            total += BigInt(l.unitPrice) * BigInt(l.qty);
            margin += BigInt(l.unitPrice - l.unitCost) * BigInt(l.qty);
        }
        const variance = payment.amountMinor - total;
        const tolerance = varianceTolerance();
        const flagged = (variance < 0n ? -variance : variance) > tolerance;

        try {
            const sale = await this.prisma.$transaction(async (tx) => {
                const created = await tx.sale.create({
                    data: {
                        organizationId: tenant.organizationId,
                        branchId,
                        total,
                        margin,
                        variance,
                        flagged,
                        idempotencyKey: dto.idempotencyKey,
                        createdBy: tenant.userId,
                        items: {
                            create: lines.map((l) => ({
                                productId: l.productId,
                                qty: l.qty,
                                unitPrice: l.unitPrice,
                                unitCost: l.unitCost,
                            })),
                        },
                        // Unique paymentId: the atomic double-tap claim.
                        allocations: {
                            create: { paymentId: payment.id, amount: payment.amountMinor },
                        },
                    },
                    include: { items: true, allocations: true },
                });

                const movements: MovementInput[] = lines.map((l) => ({
                    branchId,
                    productId: l.productId,
                    type: 'SALE',
                    qtyDelta: -l.qty,
                    refType: 'sale',
                    refId: created.id,
                    createdBy: tenant.userId,
                }));
                const crossings = await this.stock.apply(tx as unknown as never, movements);

                await this.audit.record(tx, {
                    organizationId: tenant.organizationId,
                    actorId: tenant.userId,
                    action: 'sale.created',
                    entity: 'Sale',
                    entityId: created.id,
                    after: {
                        paymentId: payment.id,
                        total: total.toString(),
                        margin: margin.toString(),
                        variance: variance.toString(),
                        flagged,
                    },
                });

                await this.outbox.enqueue(tx, {
                    type: 'sale.created',
                    organizationId: tenant.organizationId,
                    payload: {
                        saleId: created.id,
                        paymentId: payment.id,
                        branchId,
                        total: total.toString(),
                        flagged,
                    },
                });

                for (const c of crossings) {
                    await this.outbox.enqueue(tx, {
                        type: 'stock.low',
                        organizationId: tenant.organizationId,
                        payload: {
                            branchId: c.branchId,
                            productId: c.productId,
                            qty: c.qty,
                            lowStockThreshold: c.lowStockThreshold,
                        },
                    });
                }

                return created;
            });
            return this.toResponse(sale);
        } catch (error) {
            return this.toResponse(await this.handleAllocationConflict(error, tenant.organizationId, dto.idempotencyKey));
        }
    }

    private big(v: unknown): unknown {
        return typeof v === 'bigint' ? v.toString() : v;
    }

    /** Serialize BigInt money fields to strings so the JSON response is valid. */
    private toResponse(sale: any) {
        return {
            ...sale,
            total: this.big(sale.total),
            margin: this.big(sale.margin),
            variance: this.big(sale.variance),
            allocations: sale.allocations?.map((a: any) => ({ ...a, amount: this.big(a.amount) })),
        };
    }

    private async findByIdempotencyKey(organizationId: string, idempotencyKey: string) {
        return this.prisma.sale.findFirst({
            where: { organizationId, idempotencyKey },
            include: { items: true, allocations: true },
        });
    }

    private async resolveBranchId(tenant: TenantContext, paymentBranchId: string | null): Promise<string> {
        const branchId = paymentBranchId ?? tenant.branchId;
        if (branchId) return branchId;
        // Org-wide actor + no branch on the payment: fall back to the org's branch.
        const branch = await this.prisma.branch.findFirst({
            where: { organizationId: tenant.organizationId },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        });
        if (!branch) throw new BadRequestException('No branch to record the sale against');
        return branch.id;
    }

    private async handleAllocationConflict(error: unknown, organizationId: string, idempotencyKey: string) {
        const e = error as { code?: string; meta?: { target?: unknown } };
        if (e?.code === 'P2002') {
            // `target` may be field names or the index name, array or string — match loosely.
            const target = JSON.stringify(e.meta?.target ?? '');
            if (target.includes('idempotencyKey')) {
                // Same client retry hit the idempotency unique: return the original sale.
                const sale = await this.findByIdempotencyKey(organizationId, idempotencyKey);
                if (sale) return sale;
            }
            // The only other unique we write is SaleAllocation.paymentId: a second
            // request already claimed this payment — a real double-tap conflict.
            throw new ConflictException('Payment has already been allocated to a sale');
        }
        throw error;
    }
}
