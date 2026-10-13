import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { TenantContext } from '../tenancy/tenant.decorator';

const tenantA: TenantContext = {
    userId: 'user-a',
    organizationId: 'org-a',
    branchId: null,
    membershipId: 'm-a',
    roleId: 'r-a',
    permissions: ['*'],
};

function makeService() {
    const prisma = {
        product: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        auditLog: { create: jest.fn() },
        // $transaction runs the callback with `this` as the tx client.
        $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    const audit = { record: jest.fn() };
    const service = new CatalogService(prisma as never, audit as never);
    return { service, prisma, audit };
}

describe('CatalogService tenant scoping', () => {
    it('list() scopes the query by organizationId', async () => {
        const { service, prisma } = makeService();
        prisma.product.findMany.mockResolvedValue([]);

        await service.list(tenantA, {});

        expect(prisma.product.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { organizationId: 'org-a' } }),
        );
    });

    it('get() scopes by both id and organizationId', async () => {
        const { service, prisma } = makeService();
        prisma.product.findFirst.mockResolvedValue({ id: 'p1', organizationId: 'org-a' });

        await service.get(tenantA, 'p1');

        expect(prisma.product.findFirst).toHaveBeenCalledWith({
            where: { id: 'p1', organizationId: 'org-a' },
        });
    });

    it('get() treats another tenant\'s id as not found (no cross-tenant leak)', async () => {
        const { service, prisma } = makeService();
        prisma.product.findFirst.mockResolvedValue(null); // scoped query finds nothing

        await expect(service.get(tenantA, 'belongs-to-org-b')).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it('create() writes an audit entry in the same transaction', async () => {
        const { service, prisma, audit } = makeService();
        prisma.product.create.mockResolvedValue({ id: 'p1', organizationId: 'org-a' });

        await service.create(tenantA, { name: 'Soap', price: 1500, cost: 900 });

        expect(prisma.$transaction).toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalledWith(
            prisma,
            expect.objectContaining({ action: 'product.created', organizationId: 'org-a' }),
        );
    });

    it('update() flags price changes as product.price_changed', async () => {
        const { service, prisma, audit } = makeService();
        prisma.product.findFirst.mockResolvedValue({
            id: 'p1',
            organizationId: 'org-a',
            price: 1000,
            cost: 500,
        });
        prisma.product.update.mockResolvedValue({ id: 'p1', organizationId: 'org-a', price: 1200 });

        await service.update(tenantA, 'p1', { price: 1200 });

        expect(audit.record).toHaveBeenCalledWith(
            prisma,
            expect.objectContaining({ action: 'product.price_changed' }),
        );
    });
});
