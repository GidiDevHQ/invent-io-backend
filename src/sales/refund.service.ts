import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { StockService, type MovementInput } from '../inventory/stock.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { RefundDto } from './dto/refund.dto';

interface RefundLine {
    productId: string;
    qty: number;
    unitPrice: number;
    unitCost: number;
}

@Injectable()
export class RefundService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly outbox: OutboxService,
        private readonly stock: StockService,
    ) {}

    /**
     * Fully or partially reverse a sale: restore stock (RETURN movements),
     * record the refund + its lines, and audit it. Rejects over-refunding
     * (more than was sold and not already refunded). The money-back at the
     * provider is tracked here, not executed.
     */
    async refund(tenant: TenantContext, saleId: string, dto: RefundDto) {
        const sale = await this.prisma.sale.findFirst({
            where: { id: saleId, organizationId: tenant.organizationId },
            include: { items: true, refunds: { include: { items: true } } },
        });
        if (!sale) throw new NotFoundException('Sale not found');

        // What's already been refunded, per product.
        const refunded = new Map<string, number>();
        for (const r of sale.refunds) {
            for (const ri of r.items) {
                refunded.set(ri.productId, (refunded.get(ri.productId) ?? 0) + ri.qty);
            }
        }
        // What was sold, per product (snapshots carried from the sale).
        const sold = new Map<string, { qty: number; unitPrice: number; unitCost: number }>();
        for (const it of sale.items) {
            const cur = sold.get(it.productId);
            sold.set(it.productId, {
                qty: (cur?.qty ?? 0) + it.qty,
                unitPrice: it.unitPrice,
                unitCost: it.unitCost,
            });
        }

        const lines: RefundLine[] = [];
        if (dto.items && dto.items.length > 0) {
            for (const req of dto.items) {
                const s = sold.get(req.productId);
                if (!s) throw new BadRequestException(`Product ${req.productId} is not part of this sale`);
                const remaining = s.qty - (refunded.get(req.productId) ?? 0);
                if (req.qty > remaining) {
                    throw new BadRequestException(
                        `Cannot refund ${req.qty} of ${req.productId}; only ${remaining} remaining`,
                    );
                }
                lines.push({ productId: req.productId, qty: req.qty, unitPrice: s.unitPrice, unitCost: s.unitCost });
            }
        } else {
            // Full refund: everything not already refunded.
            for (const [productId, s] of sold) {
                const remaining = s.qty - (refunded.get(productId) ?? 0);
                if (remaining > 0) {
                    lines.push({ productId, qty: remaining, unitPrice: s.unitPrice, unitCost: s.unitCost });
                }
            }
        }
        if (lines.length === 0) {
            throw new BadRequestException('Nothing to refund (sale is already fully refunded)');
        }

        let amountMinor = 0n;
        let marginReversed = 0n;
        for (const l of lines) {
            amountMinor += BigInt(l.unitPrice) * BigInt(l.qty);
            marginReversed += BigInt(l.unitPrice - l.unitCost) * BigInt(l.qty);
        }
        const branchId = sale.branchId;

        const refund = await this.prisma.$transaction(async (tx) => {
            const created = await tx.refund.create({
                data: {
                    saleId: sale.id,
                    organizationId: tenant.organizationId,
                    branchId,
                    amountMinor,
                    marginReversed,
                    reason: dto.reason,
                    createdBy: tenant.userId,
                    items: {
                        create: lines.map((l) => ({
                            productId: l.productId,
                            qty: l.qty,
                            unitPrice: l.unitPrice,
                            unitCost: l.unitCost,
                        })),
                    },
                },
                include: { items: true },
            });

            if (branchId) {
                const movements: MovementInput[] = lines.map((l) => ({
                    branchId,
                    productId: l.productId,
                    type: 'RETURN',
                    qtyDelta: l.qty, // positive: stock comes back
                    refType: 'refund',
                    refId: created.id,
                    createdBy: tenant.userId,
                }));
                await this.stock.apply(tx as unknown as never, movements);
            }

            await this.audit.record(tx, {
                organizationId: tenant.organizationId,
                actorId: tenant.userId,
                action: 'sale.refunded',
                entity: 'Sale',
                entityId: sale.id,
                after: {
                    refundId: created.id,
                    amountMinor: amountMinor.toString(),
                    marginReversed: marginReversed.toString(),
                    full: !dto.items || dto.items.length === 0,
                },
            });

            await this.outbox.enqueue(tx, {
                type: 'sale.refunded',
                organizationId: tenant.organizationId,
                payload: {
                    saleId: sale.id,
                    refundId: created.id,
                    branchId,
                    amountMinor: amountMinor.toString(),
                },
            });

            return created;
        });

        return this.toResponse(refund);
    }

    private toResponse(refund: any) {
        return {
            ...refund,
            amountMinor: refund.amountMinor?.toString(),
            marginReversed: refund.marginReversed?.toString(),
        };
    }
}
