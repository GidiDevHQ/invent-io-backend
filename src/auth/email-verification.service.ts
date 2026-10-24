import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESEND_COOLDOWN_MS = 60 * 1000; // throttle resend to once a minute

export interface VerifiableUser {
    id: string;
    email: string;
    name?: string | null;
}

/**
 * Email-address confirmation. Issues a single-use, 24h token (only its SHA-256
 * hash is stored — the raw token lives only in the emailed link) and flips
 * User.emailVerified when the link is followed. The email goes out directly via
 * NotificationService (not the outbox): it is user-targeted and carries a
 * secret, so it should not be persisted/replayed as a domain event.
 */
@Injectable()
export class EmailVerificationService {
    private readonly log = new Logger(EmailVerificationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationService,
    ) {}

    private hash(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    private verifyUrl(rawToken: string): string {
        const base = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
        return `${base}/verify-email?token=${rawToken}`;
    }

    /** Create a token and email the verification link. Used on registration. */
    async issueAndSend(user: VerifiableUser): Promise<void> {
        const rawToken = randomUUID() + randomUUID();
        await this.prisma.emailVerificationToken.create({
            data: {
                userId: user.id,
                tokenHash: this.hash(rawToken),
                expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
            },
        });

        await this.notifications.send({
            organizationId: '', // account-lifecycle email; not org-scoped
            userId: user.id,
            channel: 'email',
            to: user.email,
            template: 'verify-email',
            data: { name: user.name ?? undefined, verifyUrl: this.verifyUrl(rawToken) },
        });
    }

    /**
     * Resend verification for a user, throttled. No-op (returns a reason) if the
     * address is already verified or a token was just sent.
     */
    async resend(userId: string): Promise<{ sent: boolean; reason?: string }> {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new BadRequestException('User not found');
        if (user.emailVerified) return { sent: false, reason: 'already verified' };

        const recent = await this.prisma.emailVerificationToken.findFirst({
            where: { userId, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
            orderBy: { createdAt: 'desc' },
        });
        if (recent) return { sent: false, reason: 'a verification email was just sent; try again shortly' };

        await this.issueAndSend({ id: user.id, email: user.email, name: user.name });
        return { sent: true };
    }

    /** Confirm an email address from the raw token in the link. Single-use. */
    async verify(rawToken: string): Promise<{ verified: boolean }> {
        if (!rawToken) throw new BadRequestException('Missing token');
        const tokenHash = this.hash(rawToken);
        const token = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
        if (!token || token.expiresAt < new Date()) {
            throw new BadRequestException('Verification link is invalid or has expired');
        }

        // Atomically claim the token so a double-click can't verify twice.
        const claim = await this.prisma.emailVerificationToken.updateMany({
            where: { id: token.id, usedAt: null },
            data: { usedAt: new Date() },
        });
        if (claim.count === 0) {
            throw new BadRequestException('Verification link has already been used');
        }

        await this.prisma.user.update({ where: { id: token.userId }, data: { emailVerified: true } });
        this.log.log(`email verified for user ${token.userId}`);
        return { verified: true };
    }
}
