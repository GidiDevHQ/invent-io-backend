import { WeeklySummaryService } from './weekly-summary.service';

function makeService(overrides: Record<string, unknown> = {}) {
    const prisma = {
        organization: {
            findMany: jest.fn().mockResolvedValue([{ id: 'org-1' }]),
            findUnique: jest.fn().mockResolvedValue({ currency: 'NGN' }),
        },
        notificationLog: { findFirst: jest.fn().mockResolvedValue(null) },
        membership: {
            findMany: jest.fn().mockResolvedValue([
                { userId: 'owner', user: { email: 'owner@b.com', phone: '+100' } },
            ]),
        },
        sale: { findMany: jest.fn().mockResolvedValue([{ total: 1000n, margin: 300n }, { total: 500n, margin: 100n }]) },
        saleItem: { groupBy: jest.fn().mockResolvedValue([{ productId: 'p1', _sum: { qty: 7 } }]) },
        product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Soap' }]) },
        branchStock: {
            findMany: jest.fn().mockResolvedValue([
                { productId: 'p2', qty: 1, lowStockThreshold: 5, product: { name: 'Rice' } },
                { productId: 'p3', qty: 50, lowStockThreshold: 5, product: { name: 'Water' } }, // not low
            ]),
        },
        ...overrides,
    };
    const notifications = { send: jest.fn().mockResolvedValue({ id: 'log', status: 'SENT' }) };
    const pushSubscriptions = {
        forUsers: jest.fn().mockResolvedValue([]),
        pruneByEndpoint: jest.fn().mockResolvedValue(undefined),
    };
    const service = new WeeklySummaryService(prisma as never, notifications as never, pushSubscriptions as never);
    return { service, prisma, notifications, pushSubscriptions };
}

describe('WeeklySummaryService', () => {
    it('aggregates revenue, margin, top sellers and low stock for the window', async () => {
        const { service } = makeService();
        const data = await service.buildSummary('org-1');

        expect(data.revenue).toBe('1500');
        expect(data.margin).toBe('400');
        expect(data.currency).toBe('NGN');
        expect(data.topSellers).toEqual(['Soap (7)']);
        expect(data.lowStock).toEqual(['Rice (1)']); // only the row at/below threshold
    });

    it('sends to reports-viewing recipients over email and whatsapp', async () => {
        const { service, notifications } = makeService();
        const sent = await service.runForOrg('org-1');

        expect(sent).toBe(true);
        expect(notifications.send).toHaveBeenCalledWith(
            expect.objectContaining({ channel: 'email', template: 'weekly.summary', to: 'owner@b.com' }),
        );
        expect(notifications.send).toHaveBeenCalledWith(
            expect.objectContaining({ channel: 'whatsapp', template: 'weekly.summary', to: '+100' }),
        );
    });

    it('is idempotent: a prior log for the same day skips the org', async () => {
        const { service, notifications } = makeService({
            notificationLog: { findFirst: jest.fn().mockResolvedValue({ id: 'prior' }) },
        });
        const sent = await service.runForOrg('org-1');

        expect(sent).toBe(false);
        expect(notifications.send).not.toHaveBeenCalled();
    });

    it('pushes to recipients browsers and prunes gone subscriptions', async () => {
        const { service, notifications, pushSubscriptions } = makeService();
        pushSubscriptions.forUsers.mockResolvedValue([
            { endpoint: 'https://push/a', subscription: { endpoint: 'https://push/a', keys: { p256dh: 'x', auth: 'y' } } },
        ]);
        notifications.send.mockResolvedValue({ id: 'l', status: 'FAILED', error: 'SUBSCRIPTION_GONE:https://push/a' });

        await service.runForOrg('org-1');

        expect(pushSubscriptions.pruneByEndpoint).toHaveBeenCalledWith('https://push/a');
    });

    it('runForAllOrgs isolates a failing org and reports counts', async () => {
        const { service, prisma } = makeService({
            organization: {
                findMany: jest.fn().mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }]),
                findUnique: jest.fn().mockResolvedValue({ currency: 'NGN' }),
            },
        });
        // First org fine; second org's recipient lookup throws.
        (prisma.membership.findMany as jest.Mock)
            .mockResolvedValueOnce([{ userId: 'owner', user: { email: 'o@b.com' } }])
            .mockRejectedValueOnce(new Error('db blip'));

        const res = await service.runForAllOrgs();
        expect(res.orgs).toBe(2);
        expect(res.sent).toBe(1);
        expect(res.skipped).toBe(1);
    });
});
