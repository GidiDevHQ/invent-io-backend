import { BadRequestException } from '@nestjs/common';
import { NotificationService } from './notification.service';

function makeService(channelSend: jest.Mock) {
    const create = jest.fn().mockImplementation(async ({ data }: { data: unknown }) => ({ id: 'log-1', ...(data as object) }));
    const prisma = { notificationLog: { create } };
    const simulated = { name: 'simulated', send: channelSend };
    const whatsapp = { name: 'whatsapp', send: jest.fn() };
    const email = { name: 'email', send: jest.fn() };
    const service = new NotificationService(prisma as never, simulated as never, whatsapp as never, email as never);
    return { service, create };
}

describe('NotificationService', () => {
    const base = {
        organizationId: 'org-1',
        channel: 'simulated' as const,
        to: '+100',
        template: 'payment.received',
        data: { amountMinor: '150000', currency: 'NGN' },
    };

    it('sends and logs a SENT attempt with the provider message id', async () => {
        const send = jest.fn().mockResolvedValue({ providerMessageId: 'pm-1' });
        const { service, create } = makeService(send);

        const result = await service.send(base);

        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({ to: '+100', body: expect.stringContaining('Payment received') }),
        );
        expect(result.status).toBe('SENT');
        expect(result.providerMessageId).toBe('pm-1');
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'SENT', channel: 'simulated' }) }),
        );
    });

    it('records FAILED on a provider error without throwing', async () => {
        const send = jest.fn().mockRejectedValue(new Error('provider down'));
        const { service, create } = makeService(send);

        const result = await service.send(base);

        expect(result.status).toBe('FAILED');
        expect(result.error).toBe('provider down');
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', error: 'provider down' }) }),
        );
    });

    it('rejects an unknown template', async () => {
        const { service } = makeService(jest.fn());
        await expect(service.send({ ...base, template: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    });
});
