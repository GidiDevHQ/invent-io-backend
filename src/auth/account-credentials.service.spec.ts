import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AccountCredentialsService } from './account-credentials.service';

function makeService() {
    const user = { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) };
    const prisma = { user };
    const refreshTokens = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
    const emailVerification = { issueAndSend: jest.fn().mockResolvedValue(undefined) };
    const service = new AccountCredentialsService(prisma as never, refreshTokens as never, emailVerification as never);
    return { service, user, refreshTokens, emailVerification };
}

describe('AccountCredentialsService', () => {
    let currentHash: string;
    beforeAll(async () => {
        currentHash = await argon2.hash('currentpass1');
    });

    describe('changePassword', () => {
        it('rejects a wrong current password', async () => {
            const { service, user } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: currentHash });
            await expect(service.changePassword('u1', 'wrong', 'newpassword1')).rejects.toBeInstanceOf(
                UnauthorizedException,
            );
        });

        it('rejects reusing the same password', async () => {
            const { service, user } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: currentHash });
            await expect(service.changePassword('u1', 'currentpass1', 'currentpass1')).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });

        it('hashes the new password and revokes sessions', async () => {
            const { service, user, refreshTokens } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: currentHash });

            await expect(service.changePassword('u1', 'currentpass1', 'brandnew456')).resolves.toEqual({ changed: true });
            const stored = user.update.mock.calls[0][0].data.passwordHash;
            expect(stored).not.toBe('brandnew456');
            expect(await argon2.verify(stored, 'brandnew456')).toBe(true);
            expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
        });
    });

    describe('changeEmail', () => {
        it('rejects a wrong current password', async () => {
            const { service, user } = makeService();
            user.findUnique.mockResolvedValue({ id: 'u1', email: 'old@b.com', passwordHash: currentHash });
            await expect(service.changeEmail('u1', 'wrong', 'new@b.com')).rejects.toBeInstanceOf(
                UnauthorizedException,
            );
        });

        it('rejects an email already in use', async () => {
            const { service, user } = makeService();
            user.findUnique
                .mockResolvedValueOnce({ id: 'u1', email: 'old@b.com', passwordHash: currentHash }) // assertCurrentPassword
                .mockResolvedValueOnce({ id: 'u2' }); // taken lookup
            await expect(service.changeEmail('u1', 'currentpass1', 'taken@b.com')).rejects.toBeInstanceOf(
                ConflictException,
            );
        });

        it('updates the email, unverifies it, and sends verification', async () => {
            const { service, user, emailVerification } = makeService();
            user.findUnique
                .mockResolvedValueOnce({ id: 'u1', email: 'old@b.com', name: 'A', passwordHash: currentHash })
                .mockResolvedValueOnce(null); // not taken
            user.update.mockResolvedValue({ id: 'u1', email: 'new@b.com', name: 'A' });

            const res = await service.changeEmail('u1', 'currentpass1', 'New@B.com');
            expect(res).toEqual({ changed: true, verificationSent: true });
            expect(user.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { email: 'new@b.com', emailVerified: false } }),
            );
            expect(emailVerification.issueAndSend).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'u1', email: 'new@b.com' }),
            );
        });
    });
});
