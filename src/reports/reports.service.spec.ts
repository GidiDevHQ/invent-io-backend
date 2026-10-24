import { ReportsService } from './reports.service';
import type { TenantContext } from '../tenancy/tenant.decorator';

const tenant: TenantContext = {
    userId: 'u1',
    organizationId: 'org-1',
    branchId: 'b1',
    membershipId: 'm1',
    roleId: 'r1',
    permissions: ['*'],
};

function makeService(sales: { total: bigint; margin: bigint }[], branchStock: any[]) {
    const prisma = {
        organization: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
        sale: { findMany: jest.fn().mockResolvedValue(sales) },
        branchStock: { findMany: jest.fn().mockResolvedValue(branchStock) },
    };
    return { service: new ReportsService(prisma as never), prisma };
}

describe('ReportsService', () => {
    it('sums revenue and margin and counts low-stock for the dashboard', async () => {
        const { service } = makeService(
            [
                { total: 150000n, margin: 50000n },
                { total: 300000n, margin: 120000n },
            ],
            [
                { branchId: 'b1', productId: 'p1', qty: 2, lowStockThreshold: 5, flags: [] }, // low
                { branchId: 'b1', productId: 'p2', qty: 20, lowStockThreshold: 5, flags: [] }, // ok
                { branchId: 'b1', productId: 'p3', qty: 0, lowStockThreshold: 0, flags: [] }, // threshold 0 -> ignored
            ],
        );

        const res = await service.dashboardSummary(tenant, '2026-10-24');

        expect(res.salesCount).toBe(2);
        expect(res.revenue).toBe('450000'); // strings, not BigInt
        expect(res.margin).toBe('170000');
        expect(res.lowStockCount).toBe(1);
    });

    it('returns only items at/below a positive threshold for low-stock', async () => {
        const { service } = makeService(
            [],
            [
                { branchId: 'b1', productId: 'p1', qty: 5, lowStockThreshold: 5, flags: [], product: { name: 'Soap' } },
                { branchId: 'b1', productId: 'p2', qty: 6, lowStockThreshold: 5, flags: [], product: { name: 'Rice' } },
            ],
        );

        const rows = await service.lowStock(tenant);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ productId: 'p1', productName: 'Soap', qty: 5 });
    });
});
