import { BadRequestException } from '@nestjs/common';
import { CatalogImportService } from './catalog-import.service';
import type { TenantContext } from '../tenancy/tenant.decorator';

const tenant: TenantContext = {
    userId: 'u1',
    organizationId: 'org-1',
    branchId: null,
    membershipId: 'm1',
    roleId: 'r1',
    permissions: ['*'],
};

function makeService() {
    const product = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'existing', ...data })),
    };
    const tx = { product };
    const prisma = { $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
    const audit = { record: jest.fn() };
    const service = new CatalogImportService(prisma as never, audit as never);
    return { service, product, prisma, audit };
}

describe('CatalogImportService.importCsv', () => {
    it('rejects a CSV missing a required column', async () => {
        const { service } = makeService();
        await expect(service.importCsv(tenant, 'name,price\nSoap,150')).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });

    it('creates products for valid rows', async () => {
        const { service, product } = makeService();
        const csv = 'name,sku,price,cost\nSoap,S1,150,90\nRice,R1,500,400';

        const res = await service.importCsv(tenant, csv);

        expect(res).toMatchObject({ total: 2, created: 2, updated: 0, skipped: 0 });
        expect(product.create).toHaveBeenCalledTimes(2);
    });

    it('updates an existing product matched by sku (upsert)', async () => {
        const { service, product } = makeService();
        product.findFirst.mockResolvedValueOnce({ id: 'existing', sku: 'S1', price: 100, cost: 50 });

        const res = await service.importCsv(tenant, 'name,sku,price,cost\nSoap,S1,150,90');

        expect(res).toMatchObject({ created: 0, updated: 1, skipped: 0 });
        expect(product.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ price: 150, version: { increment: 1 } }) }),
        );
    });

    it('skips rows with a bad price and reports the row number, importing the rest', async () => {
        const { service, product } = makeService();
        const csv = 'name,price,cost\nGood,150,90\nBad,12.5,90\nNoName,,100';

        const res = await service.importCsv(tenant, csv);

        expect(res.created).toBe(1);
        expect(res.skipped).toBe(2);
        expect(res.errors).toEqual([
            { row: 2, message: expect.stringContaining('price') },
            { row: 3, message: expect.stringContaining('price') },
        ]);
        expect(product.create).toHaveBeenCalledTimes(1);
    });

    it('reports a duplicate-sku DB conflict as a skipped row', async () => {
        const { service, product } = makeService();
        product.create.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['organizationId', 'sku'] } });

        const res = await service.importCsv(tenant, 'name,sku,price,cost\nSoap,S1,150,90');

        expect(res.created).toBe(0);
        expect(res.skipped).toBe(1);
        expect(res.errors[0].message).toContain('duplicate');
    });
});
