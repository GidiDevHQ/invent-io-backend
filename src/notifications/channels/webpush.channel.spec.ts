import webpush from 'web-push';
import { WebPushChannel, SUBSCRIPTION_GONE } from './webpush.channel';

jest.mock('web-push', () => ({
    __esModule: true,
    default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() },
}));

const sendNotification = webpush.sendNotification as jest.Mock;
const setVapidDetails = webpush.setVapidDetails as jest.Mock;

const sub = JSON.stringify({ endpoint: 'https://push/a', keys: { p256dh: 'p', auth: 'a' } });

describe('WebPushChannel', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...OLD_ENV, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
    });
    afterAll(() => {
        process.env = OLD_ENV;
    });

    it('throws when VAPID keys are not configured', async () => {
        delete process.env.VAPID_PUBLIC_KEY;
        const ch = new WebPushChannel();
        await expect(ch.send({ to: sub, body: 'hi' })).rejects.toThrow(/not configured/i);
    });

    it('sets VAPID details and sends a JSON title/body payload', async () => {
        sendNotification.mockResolvedValue({ headers: { location: 'loc-1' } });
        const ch = new WebPushChannel();

        const res = await ch.send({ to: sub, subject: 'Payment received', body: 'What did you sell?' });

        expect(setVapidDetails).toHaveBeenCalled();
        expect(sendNotification).toHaveBeenCalledWith(
            { endpoint: 'https://push/a', keys: { p256dh: 'p', auth: 'a' } },
            JSON.stringify({ title: 'Payment received', body: 'What did you sell?' }),
        );
        expect(res.providerMessageId).toBe('loc-1');
    });

    it('rejects a malformed subscription', async () => {
        const ch = new WebPushChannel();
        await expect(ch.send({ to: 'not-json', body: 'hi' })).rejects.toThrow(/Invalid push subscription/);
    });

    it('flags a gone subscription (410) for pruning', async () => {
        sendNotification.mockRejectedValue({ statusCode: 410 });
        const ch = new WebPushChannel();
        await expect(ch.send({ to: sub, body: 'hi' })).rejects.toThrow(
            `${SUBSCRIPTION_GONE}:https://push/a`,
        );
    });

    it('propagates other provider failures without the gone marker', async () => {
        sendNotification.mockRejectedValue({ statusCode: 500, message: 'server error' });
        const ch = new WebPushChannel();
        await expect(ch.send({ to: sub, body: 'hi' })).rejects.toThrow('server error');
    });
});
