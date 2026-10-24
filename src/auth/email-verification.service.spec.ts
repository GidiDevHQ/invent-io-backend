import { BadRequestException } from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';

function makeService(overrides: Record<string, unknown> = {}) {
    const emailVerificationToken = {
        create: jest.fn().mockResolvedValue({ id: 't1' }),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(null),
    };
    const user = {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
    };
    const prisma = { emailVerificationToken, user, ...overrides };
    const notifications = { send: jest.fn().mockResolvedValue({ id: 'log', status: 'SENT' }) };
    const service = new EmailVerificationService(prisma as never, notifications as never);
    return { service, prisma, notifications, emailVerificationToken, user };
}

describe('EmailVerificationService', () => {
    it('issueAndSend stores a token and emails a verify link', async () => {
        const { service, notifications, emailVerificationToken } = makeService();

        await service.issueAndSend({ id: 'u1', email: 'a@b.com', name: 'Ada' });

        expect(emailVerificationToken.create).toHaveBeenCalled();
        const call = notifications.send.mock.calls[0][0];
        expect(call).toMatchObject({ channel: 'email', template: 'verify-email', to: 'a@b.com' });
        expect(call.data.verifyUrl).toContain('/verify-email?token=');
        // The raw token is in the link, not the stored row (which holds the hash).
        const storedHash = emailVerificationToken.create.mock.calls[0][0].data.tokenHash;
        expect(call.data.verifyUrl).not.toContain(storedHash);
    });

    it('verify accepts a valid token, claims it, and flips emailVerified', async () => {
        const { service, emailVerificationToken, user } = makeService();
        emailVerificationToken.findUnique.mockResolvedValue({
            id: 't1',
            userId: 'u1',
            expiresAt: new Date(Date.now() + 10000),
            usedAt: null,
        });

        await expect(service.verify('raw')).resolves.toEqual({ verified: true });
        expect(emailVerificationToken.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 't1', usedAt: null } }),
        );
        expect(user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { emailVerified: true } });
    });

    it('verify rejects an unknown or expired token', async () => {
        const { service, emailVerificationToken } = makeService();
        emailVerificationToken.findUnique.mockResolvedValue(null);
        await expect(service.verify('raw')).rejects.toBeInstanceOf(BadRequestException);

        emailVerificationToken.findUnique.mockResolvedValue({
            id: 't1', userId: 'u1', expiresAt: new Date(Date.now() - 1000), usedAt: null,
        });
        await expect(service.verify('raw')).rejects.toThrow(/invalid or has expired/i);
    });

    it('verify rejects a token already used (lost the atomic claim)', async () => {
        const { service, emailVerificationToken } = makeService();
        emailVerificationToken.findUnique.mockResolvedValue({
            id: 't1', userId: 'u1', expiresAt: new Date(Date.now() + 10000), usedAt: null,
        });
        emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.verify('raw')).rejects.toThrow(/already been used/i);
    });

    it('resend is a no-op when already verified or recently sent', async () => {
        const { service, user, emailVerificationToken } = makeService();
        user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'Ada', emailVerified: true });
        await expect(service.resend('u1')).resolves.toEqual({ sent: false, reason: 'already verified' });

        user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'Ada', emailVerified: false });
        emailVerificationToken.findFirst.mockResolvedValue({ id: 'recent', createdAt: new Date() });
        const res = await service.resend('u1');
        expect(res.sent).toBe(false);
    });

    it('resend issues a new token when none is recent', async () => {
        const { service, user, notifications } = makeService();
        user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'Ada', emailVerified: false });
        await expect(service.resend('u1')).resolves.toEqual({ sent: true });
        expect(notifications.send).toHaveBeenCalled();
    });
});
