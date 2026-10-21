import { NotificationDispatcher } from './notification-dispatcher';

function makeDispatcher(
    members: { userId: string; email?: string; phone?: string }[],
    alreadyDispatched = false,
) {
    const prisma = {
        membership: {
            findMany: jest.fn().mockResolvedValue(
                members.map((m) => ({ userId: m.userId, user: { email: m.email ?? '', phone: m.phone ?? null } })),
            ),
        },
        notificationLog: {
            findFirst: jest.fn().mockResolvedValue(alreadyDispatched ? { id: 'prior' } : null),
        },
    };
    const notifications = { send: jest.fn().mockResolvedValue({ id: 'log', status: 'SENT' }) };
    const dispatcher = new NotificationDispatcher(prisma as never, notifications as never);
    return { dispatcher, notifications };
}

describe('NotificationDispatcher', () => {
    it('payment.confirmed notifies org members by email and whatsapp (phone present)', async () => {
        const { dispatcher, notifications } = makeDispatcher([
            { userId: 'u1', email: 'a@b.com', phone: '+100' },
        ]);

        await dispatcher.handle({
            type: 'payment.confirmed',
            payload: { organizationId: 'org-1', amountMinor: '150000', currency: 'NGN' },
        });

        expect(notifications.send).toHaveBeenCalledWith(
            expect.objectContaining({ channel: 'email', template: 'payment.received', to: 'a@b.com' }),
        );
        expect(notifications.send).toHaveBeenCalledWith(
            expect.objectContaining({ channel: 'whatsapp', template: 'payment.received', to: '+100' }),
        );
    });

    it('skips whatsapp when the user has no phone', async () => {
        const { dispatcher, notifications } = makeDispatcher([{ userId: 'u1', email: 'a@b.com' }]);

        await dispatcher.handle({ type: 'stock.low', payload: { organizationId: 'org-1', productId: 'p1', qty: 1 } });

        const channels = notifications.send.mock.calls.map((c) => c[0].channel);
        expect(channels).toEqual(['email']);
        expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'stock.low' }));
    });

    it('only alerts on sale.created when flagged', async () => {
        const { dispatcher, notifications } = makeDispatcher([{ userId: 'u1', email: 'a@b.com' }]);

        await dispatcher.handle({ type: 'sale.created', payload: { organizationId: 'org-1', flagged: false } });
        expect(notifications.send).not.toHaveBeenCalled();

        await dispatcher.handle({ type: 'sale.created', payload: { organizationId: 'org-1', flagged: true, variance: '-100000', currency: 'NGN' } });
        expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'sale.variance' }));
    });

    it('ignores unknown event types', async () => {
        const { dispatcher, notifications } = makeDispatcher([{ userId: 'u1', email: 'a@b.com' }]);
        await dispatcher.handle({ type: 'something.else', payload: { organizationId: 'org-1' } });
        expect(notifications.send).not.toHaveBeenCalled();
    });

    it('skips an event already dispatched (dedup on redelivery)', async () => {
        const { dispatcher, notifications } = makeDispatcher([{ userId: 'u1', email: 'a@b.com' }], true);
        await dispatcher.handle({
            id: 'evt-1',
            type: 'payment.confirmed',
            organizationId: 'org-1',
            payload: { amountMinor: '1000', currency: 'NGN' },
        });
        expect(notifications.send).not.toHaveBeenCalled();
    });
});
