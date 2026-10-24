import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { RefreshTokenService } from './refresh-token.service';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const THROTTLE_MS = 60 * 1000; // at most one reset email a minute per user

/**
 * Forgotten-password reset. Issues a single-use, 1h token (only its SHA-256 hash
 * is stored — the raw token lives only in the emailed link) and, on reset, sets
 * the new password and revokes every active session. Requesting a reset never
 * reveals whether an email is registered (no account enumeration).
 */
@Injectable()
export class PasswordResetService {
    private readonly log = new Logger(PasswordResetService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationService,
        private readonly refreshTokens: RefreshTokenService,
    ) {}

    private hash(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    private resetUrl(rawToken: string): string {
        const base = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
        return `${base}/reset-password?token=${rawToken}`;
    }

    /**
     * Email a reset link if the address belongs to a user. Always resolves the
     * same way regardless, so a caller can't probe which emails exist.
     */
    async request(email: string): Promise<{ sent: true }> {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (user) {
            const recent = await this.prisma.passwordResetToken.findFirst({
                where: { userId: user.id, createdAt: { gt: new Date(Date.now() - THROTTLE_MS) } },
            });
            if (!recent) {
                const rawToken = randomUUID() + randomUUID();
                await this.prisma.passwordResetToken.create({
                    data: {
                        userId: user.id,
                        tokenHash: this.hash(rawToken),
                        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
                    },
                });
                await this.notifications.send({
                    organizationId: '',
                    userId: user.id,
                    channel: 'email',
                    to: user.email,
                    template: 'password.reset',
                    data: { resetUrl: this.resetUrl(rawToken) },
                });
            }
        }
        // Uniform response whether or not the user exists.
        return { sent: true };
    }

    /** Consume a reset token, set the new password, and end all sessions. */
    async reset(rawToken: string, newPassword: string): Promise<{ reset: boolean }> {
        if (!rawToken) throw new BadRequestException('Missing token');
        const token = await this.prisma.passwordResetToken.findUnique({
            where: { tokenHash: this.hash(rawToken) },
        });
        if (!token || token.expiresAt < new Date()) {
            throw new BadRequestException('Reset link is invalid or has expired');
        }

        // Atomically claim so a token can be used only once.
        const claim = await this.prisma.passwordResetToken.updateMany({
            where: { id: token.id, usedAt: null },
            data: { usedAt: new Date() },
        });
        if (claim.count === 0) {
            throw new BadRequestException('Reset link has already been used');
        }

        const passwordHash = await argon2.hash(newPassword);
        await this.prisma.user.update({ where: { id: token.userId }, data: { passwordHash } });
        // A reset implies the old credentials may be compromised — kill all sessions.
        await this.refreshTokens.revokeAllForUser(token.userId);
        this.log.log(`password reset for user ${token.userId}; sessions revoked`);
        return { reset: true };
    }
}
