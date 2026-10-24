import { BadRequestException } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';

function makeService(overrides: Record<string, unknown> = {}) {
    const passwordResetToken = {
        create: jest.fn().mockResolvedValue({ id: 't1' }),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(null),
    };
    const user = { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) };
    const prisma = { passwordResetToken, user, ...overrides };
    const notifications = { send: jest.fn().mockResolvedValue({ id: 'log', status: 'SENT' }) };
    const refreshTokens = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
    const service = new PasswordResetService(prisma as never, notifications as never, refreshTokens as never);
    return { service, prisma, notifications, refreshTokens, passwordResetToken, user };
}

describe('PasswordResetService', () => {
    describe('request', () => {
        it('emails a reset link when the user exists', async () => {
            const { service, user, notifications, passwordResetToken } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });

            await expect(service.request('a@b.com')).resolves.toEqual({ sent: true });
            expect(passwordResetToken.create).toHaveBeenCalled();
            const call = notifications.send.mock.calls[0][0];
            expect(call).toMatchObject({ template: 'password.reset', to: 'a@b.com' });
            expect(call.data.resetUrl).toContain('/reset-password?token=');
        });

        it('does not reveal a missing account (uniform response, no email)', async () => {
            const { service, user, notifications } = makeService();
            user.findUnique.mockResolvedValue(null);

            await expect(service.request('ghost@b.com')).resolves.toEqual({ sent: true });
            expect(notifications.send).not.toHaveBeenCalled();
        });

        it('throttles a rapid second request', async () => {
            const { service, user, notifications, passwordResetToken } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
            passwordResetToken.findFirst.mockResolvedValue({ id: 'recent' });

            await service.request('a@b.com');
            expect(notifications.send).not.toHaveBeenCalled();
        });
    });

    describe('reset', () => {
        it('sets the new password, claims the token, and revokes sessions', async () => {
            const { service, passwordResetToken, user, refreshTokens } = makeService();
            passwordResetToken.findUnique.mockResolvedValue({
                id: 't1', userId: 'u1', expiresAt: new Date(Date.now() + 10000), usedAt: null,
            });

            await expect(service.reset('raw', 'newpassword1')).resolves.toEqual({ reset: true });
            expect(user.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'u1' } }),
            );
            // Stored password is a hash, never the plaintext.
            expect(user.update.mock.calls[0][0].data.passwordHash).not.toBe('newpassword1');
            expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
        });

        it('rejects an invalid/expired token', async () => {
            const { service, passwordResetToken } = makeService();
            passwordResetToken.findUnique.mockResolvedValue(null);
            await expect(service.reset('raw', 'newpassword1')).rejects.toBeInstanceOf(BadRequestException);
        });

        it('rejects a token already used (lost the atomic claim)', async () => {
            const { service, passwordResetToken, refreshTokens } = makeService();
            passwordResetToken.findUnique.mockResolvedValue({
                id: 't1', userId: 'u1', expiresAt: new Date(Date.now() + 10000), usedAt: null,
            });
            passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
            await expect(service.reset('raw', 'newpassword1')).rejects.toThrow(/already been used/i);
            expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
        });
    });
});
