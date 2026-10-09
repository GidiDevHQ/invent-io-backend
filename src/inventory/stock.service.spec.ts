import { StockService } from './stock.service';

/**
 * Builds a StockService with a mock transaction client whose branch_stock row
 * starts at `startQty`/`threshold`. upsert simulates the atomic increment.
 */
function makeService(startQty: number, threshold = 0, startFlags: string[] = []) {
    let row = { qty: startQty, lowStockThreshold: threshold, flags: startFlags };
    const tx = {
        stockMovement: { create: jest.fn().mockResolvedValue({}) },
        branchStock: {
            findUnique: jest.fn().mockImplementation(async () => (row ? { ...row } : null)),
            upsert: jest.fn().mockImplementation(async ({ update }: any) => {
                const inc = update.qty.increment as number;
                row = { ...row, qty: row.qty + inc };
                return { ...row };
            }),
            update: jest.fn().mockImplementation(async ({ data }: any) => {
                if (data.flags) row = { ...row, flags: data.flags };
                return { ...row };
            }),
        },
    };
    const service = new StockService({} as never, {} as never);
    return { service, tx, getRow: () => row };
}

describe('StockService.apply', () => {
    const base = { branchId: 'b1', productId: 'p1' };

    it('increments quantity atomically and writes a ledger row', async () => {
        const { service, tx, getRow } = makeService(5);
        await service.apply(tx as never, [{ ...base, type: 'RESTOCK', qtyDelta: 10 }]);
        expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
        expect(getRow().qty).toBe(15);
    });

    it('allows negative stock and flags it (never blocks)', async () => {
        const { service, tx, getRow } = makeService(5);
        const crossings = await service.apply(tx as never, [{ ...base, type: 'SALE', qtyDelta: -8 }]);
        expect(getRow().qty).toBe(-3);
        expect(getRow().flags).toContain('NEGATIVE_STOCK');
        expect(crossings).toEqual([]); // no threshold set
    });

    it('clears the negative flag once stock recovers', async () => {
        const { service, tx, getRow } = makeService(-3, 0, ['NEGATIVE_STOCK']);
        await service.apply(tx as never, [{ ...base, type: 'RESTOCK', qtyDelta: 5 }]);
        expect(getRow().qty).toBe(2);
        expect(getRow().flags).not.toContain('NEGATIVE_STOCK');
    });

    it('reports a low-stock threshold crossing (above -> at/below)', async () => {
        const { service, tx } = makeService(12, 10);
        const crossings = await service.apply(tx as never, [{ ...base, type: 'SALE', qtyDelta: -3 }]);
        expect(crossings).toHaveLength(1);
        expect(crossings[0]).toMatchObject({ qty: 9, lowStockThreshold: 10 });
    });

    it('does not re-report when already below threshold', async () => {
        const { service, tx } = makeService(8, 10);
        const crossings = await service.apply(tx as never, [{ ...base, type: 'SALE', qtyDelta: -1 }]);
        expect(crossings).toEqual([]);
    });
});
