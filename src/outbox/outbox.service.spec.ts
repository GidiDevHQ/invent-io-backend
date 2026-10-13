import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
    it('writes an outbox row using the provided transaction client', async () => {
        const create = jest.fn().mockResolvedValue({});
        const tx = { outboxEvent: { create } };
        const service = new OutboxService();

        await service.enqueue(tx, { type: 'payment.received', payload: { paymentId: 'p1' } });

        expect(create).toHaveBeenCalledWith({
            data: { type: 'payment.received', payload: { paymentId: 'p1' } },
        });
    });
});
