import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { OtpService } from './otp.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function makeService(overrides: Record<string, unknown> = {}) {
    const otpCode = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'o1' }),
        update: jest.fn().mockResolvedValue({}),
    };
    const user = { findUnique: jest.fn(), findFirst: jest.fn() };
    const prisma = { otpCode, user, ...overrides };
    const notifications = { send: jest.fn().mockResolvedValue({ id: 'log', status: 'SENT' }) };
    const refreshTokens = { issue: jest.fn().mockResolvedValue('refresh-1') };
    const auth = { signAccessToken: jest.fn().mockResolvedValue('access-1') };
    const service = new OtpService(prisma as never, notifications as never, refreshTokens as never, auth as never);
    return { service, prisma, notifications, refreshTokens, auth, otpCode, user };
}

describe('OtpService', () => {
    describe('request', () => {
        it('emails a code to a known email identifier', async () => {
            const { service, user, notifications, otpCode } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });

            await expect(service.request('a@b.com')).resolves.toEqual({ sent: true });
            expect(otpCode.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', channel: 'email' }) }),
            );
            const call = notifications.send.mock.calls[0][0];
            expect(call).toMatchObject({ channel: 'email', template: 'otp', to: 'a@b.com' });
            expect(String(call.data.code)).toMatch(/^\d{6}$/);
        });

        it('sends over whatsapp for a phone identifier', async () => {
            const { service, user, notifications } = makeService();
            user.findFirst.mockResolvedValue({ id: 'u1', phone: '+2348000', email: 'a@b.com' });

            await service.request('+2348000');
            expect(notifications.send).toHaveBeenCalledWith(
                expect.objectContaining({ channel: 'whatsapp', to: '+2348000', template: 'otp' }),
            );
        });

        it('does not reveal an unknown identifier and sends nothing', async () => {
            const { service, user, notifications } = makeService();
            user.findUnique.mockResolvedValue(null);
            await expect(service.request('ghost@b.com')).resolves.toEqual({ sent: true });
            expect(notifications.send).not.toHaveBeenCalled();
        });

        it('throttles a rapid second request', async () => {
            const { service, user, notifications, otpCode } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
            otpCode.findFirst.mockResolvedValue({ id: 'recent' });
            await service.request('a@b.com');
            expect(notifications.send).not.toHaveBeenCalled();
        });
    });

    describe('verify', () => {
        const validOtp = (code: string) => ({
            id: 'o1', userId: 'u1', codeHash: sha256(code), expiresAt: new Date(Date.now() + 10000), attempts: 0,
        });

        it('issues a session for the right code and consumes it', async () => {
            const { service, user, otpCode, refreshTokens, auth } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
            otpCode.findFirst.mockResolvedValue(validOtp('123456'));

            const res = await service.verify('a@b.com', '123456');
            expect(res).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1', userId: 'u1' });
            expect(auth.signAccessToken).toHaveBeenCalledWith('u1');
            expect(refreshTokens.issue).toHaveBeenCalledWith('u1');
            expect(otpCode.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ consumedAt: expect.any(Date) }) }),
            );
        });

        it('increments attempts and rejects a wrong code', async () => {
            const { service, user, otpCode } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
            otpCode.findFirst.mockResolvedValue(validOtp('123456'));

            await expect(service.verify('a@b.com', '000000')).rejects.toBeInstanceOf(UnauthorizedException);
            expect(otpCode.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { attempts: { increment: 1 } } }),
            );
        });

        it('locks after too many attempts', async () => {
            const { service, user, otpCode } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
            otpCode.findFirst.mockResolvedValue({ ...validOtp('123456'), attempts: 5 });
            await expect(service.verify('a@b.com', '123456')).rejects.toThrow(/too many attempts/i);
        });

        it('rejects an expired code', async () => {
            const { service, user, otpCode } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
            otpCode.findFirst.mockResolvedValue({ ...validOtp('123456'), expiresAt: new Date(Date.now() - 1000) });
            await expect(service.verify('a@b.com', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects an unknown identifier', async () => {
            const { service, user } = makeService();
            user.findUnique.mockResolvedValue(null);
            await expect(service.verify('ghost@b.com', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
        });
    });
});
