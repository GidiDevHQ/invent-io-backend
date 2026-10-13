import { OutboxPublisher } from './outbox.publisher';

function makePublisher(pending: { id: string; type: string; payload: unknown }[]) {
    const store = [...pending];
    const add = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        const i = store.findIndex((e) => e.id === where.id);
        if (i >= 0) store.splice(i, 1); // mark processed -> no longer pending
        return {};
    });
    const prisma = {
        outboxEvent: {
            findMany: jest.fn().mockImplementation(async ({ take }: { take: number }) => store.slice(0, take)),
            update,
        },
    };
    const queue = { add };
    return { publisher: new OutboxPublisher(prisma as never, queue as never), add, update, store };
}

describe('OutboxPublisher', () => {
    it('publishes each pending event with jobId = event id, then marks processed', async () => {
        const { publisher, add, update } = makePublisher([
            { id: 'e1', type: 'payment.received', payload: { a: 1 } },
            { id: 'e2', type: 'sale.created', payload: { b: 2 } },
        ]);

        const count = await publisher.publishPending();

        expect(count).toBe(2);
        expect(add).toHaveBeenCalledWith('payment.received', expect.objectContaining({ id: 'e1' }), { jobId: 'e1' });
        expect(add).toHaveBeenCalledWith('sale.created', expect.objectContaining({ id: 'e2' }), { jobId: 'e2' });
        expect(update).toHaveBeenCalledTimes(2);
    });

    it('is a no-op when there is nothing pending (re-run after processing)', async () => {
        const { publisher, add } = makePublisher([]);
        const count = await publisher.publishPending();
        expect(count).toBe(0);
        expect(add).not.toHaveBeenCalled();
    });
});
