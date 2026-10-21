import { ConflictException } from '@nestjs/common';
import { SalesService } from './sales.service';
import type { TenantContext } from '../tenancy/tenant.decorator';

const tenant: TenantContext = {
    userId: 'u1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    membershipId: 'm1',
    roleId: 'r1',
    permissions: ['*'],
};

function makeService(overrides: Record<string, unknown> = {}) {
    const txSale = { create: jest.fn() };
    const prisma = {
        sale: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
        payment: { findFirst: jest.fn() },
        product: { findMany: jest.fn() },
        branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
        $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({ sale: txSale })),
        ...overrides,
    };
    const audit = { record: jest.fn() };
    const outbox = { enqueue: jest.fn() };
    const stock = { apply: jest.fn().mockResolvedValue([]) };
    const service = new SalesService(prisma as never, audit as never, outbox as never, stock as never);
    return { service, prisma, txSale, audit, outbox, stock };
}

describe('SalesService.allocate', () => {
    const dto = { items: [{ productId: 'p1', qty: 2 }], idempotencyKey: 'key-1' };

    it('returns the original sale on an idempotency replay (no new write)', async () => {
        const { service, prisma } = makeService();
        prisma.sale.findFirst.mockResolvedValue({ id: 'sale-existing', items: [], allocations: [] });

        const result = await service.allocate(tenant, 'pay-1', dto);

        expect(result.id).toBe('sale-existing');
        expect(prisma.payment.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a payment that is not SUCCEEDED', async () => {
        const { service, prisma } = makeService();
        prisma.payment.findFirst.mockResolvedValue({ id: 'pay-1', status: 'PENDING', organizationId: 'org-1' });

        await expect(service.allocate(tenant, 'pay-1', dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('snapshots price/cost and computes total, margin, and flagged variance', async () => {
        const { service, prisma, txSale, stock, outbox } = makeService();
        prisma.payment.findFirst.mockResolvedValue({
            id: 'pay-1',
            status: 'SUCCEEDED',
            organizationId: 'org-1',
            branchId: 'branch-1',
            amountMinor: 1000n, // payment says 1000; items total 600 -> variance 400 (flagged)
        });
        prisma.product.findMany.mockResolvedValue([
            { id: 'p1', price: 300, cost: 200, active: true, organizationId: 'org-1' },
        ]);
        txSale.create.mockResolvedValue({ id: 'sale-1', items: [], allocations: [] });

        await service.allocate(tenant, 'pay-1', dto);

        expect(txSale.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    total: 600n,
                    margin: 200n,
                    variance: 400n,
                    flagged: true,
                    allocations: { create: { paymentId: 'pay-1', amount: 1000n } },
                }),
            }),
        );
        // Stock decremented by the sold quantity as a SALE movement.
        expect(stock.apply).toHaveBeenCalledWith(
            expect.anything(),
            [expect.objectContaining({ productId: 'p1', qtyDelta: -2, type: 'SALE' })],
        );
        expect(outbox.enqueue).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ type: 'sale.created' }),
        );
    });
});
