import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RefundService } from './refund.service';
import type { TenantContext } from '../tenancy/tenant.decorator';

const tenant: TenantContext = {
    userId: 'u1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    membershipId: 'm1',
    roleId: 'r1',
    permissions: ['*'],
};

function makeService(sale: unknown) {
    // Echo back the persisted row the way Prisma would (so toResponse can serialize it).
    const txRefund = {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'refund-1',
            items: [],
            amountMinor: data.amountMinor,
            marginReversed: data.marginReversed,
        })),
    };
    const prisma = {
        sale: { findFirst: jest.fn().mockResolvedValue(sale) },
        $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({ refund: txRefund })),
    };
    const audit = { record: jest.fn() };
    const outbox = { enqueue: jest.fn() };
    const stock = { apply: jest.fn().mockResolvedValue([]) };
    const service = new RefundService(prisma as never, audit as never, outbox as never, stock as never);
    return { service, prisma, txRefund, audit, outbox, stock };
}

// A sale of 2x p1 (price 300, cost 200) and 1x p2 (price 500, cost 400), nothing refunded yet.
const baseSale = {
    id: 'sale-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    items: [
        { productId: 'p1', qty: 2, unitPrice: 300, unitCost: 200 },
        { productId: 'p2', qty: 1, unitPrice: 500, unitCost: 400 },
    ],
    refunds: [],
};

describe('RefundService.refund', () => {
    it('404s when the sale is not in the tenant org', async () => {
        const { service } = makeService(null);
        await expect(service.refund(tenant, 'missing', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('full refund: reverses every remaining line, restores stock, totals money + margin', async () => {
        const { service, txRefund, stock, outbox, audit } = makeService(baseSale);

        const res = await service.refund(tenant, 'sale-1', {});

        // amount = 2*300 + 1*500 = 1100; margin = 2*(300-200) + 1*(500-400) = 300
        expect(txRefund.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ amountMinor: 1100n, marginReversed: 300n }),
            }),
        );
        // RETURN movements with positive deltas (stock comes back).
        expect(stock.apply).toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining([
                expect.objectContaining({ productId: 'p1', qtyDelta: 2, type: 'RETURN' }),
                expect.objectContaining({ productId: 'p2', qtyDelta: 1, type: 'RETURN' }),
            ]),
        );
        expect(audit.record).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: 'sale.refunded' }),
        );
        expect(outbox.enqueue).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ type: 'sale.refunded' }),
        );
        // BigInt serialized to strings at the boundary.
        expect(res.amountMinor).toBe('1100');
        expect(res.marginReversed).toBe('300');
    });

    it('partial refund: only the requested line', async () => {
        const { service, txRefund, stock } = makeService(baseSale);

        await service.refund(tenant, 'sale-1', { items: [{ productId: 'p1', qty: 1 }] });

        expect(txRefund.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ amountMinor: 300n, marginReversed: 100n }),
            }),
        );
        expect(stock.apply).toHaveBeenCalledWith(
            expect.anything(),
            [expect.objectContaining({ productId: 'p1', qtyDelta: 1, type: 'RETURN' })],
        );
    });

    it('rejects over-refunding past the remaining quantity', async () => {
        const sale = {
            ...baseSale,
            refunds: [{ items: [{ productId: 'p1', qty: 1 }] }], // 1 of 2 already refunded
        };
        const { service } = makeService(sale);

        await expect(
            service.refund(tenant, 'sale-1', { items: [{ productId: 'p1', qty: 2 }] }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a product that was never part of the sale', async () => {
        const { service } = makeService(baseSale);
        await expect(
            service.refund(tenant, 'sale-1', { items: [{ productId: 'ghost', qty: 1 }] }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the sale is already fully refunded', async () => {
        const sale = {
            ...baseSale,
            refunds: [{ items: [
                { productId: 'p1', qty: 2 },
                { productId: 'p2', qty: 1 },
            ] }],
        };
        const { service } = makeService(sale);
        await expect(service.refund(tenant, 'sale-1', {})).rejects.toBeInstanceOf(BadRequestException);
    });
});
