import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthService } from './auth.service';

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5; // wrong guesses before the code is locked
const RESEND_COOLDOWN_MS = 30 * 1000; // at most one code every 30s per user

/**
 * Passwordless login with a 6-digit one-time code. The code is emailed or sent
 * over WhatsApp (whichever the identifier is) and only its SHA-256 hash is
 * stored. Requests never reveal whether an identifier is registered, codes
 * expire in 5 minutes, and too many wrong guesses lock the code.
 */
@Injectable()
export class OtpService {
    private readonly log = new Logger(OtpService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationService,
        private readonly refreshTokens: RefreshTokenService,
        private readonly auth: AuthService,
    ) {}

    private hash(code: string): string {
        return createHash('sha256').update(code).digest('hex');
    }

    private async findUser(identifier: string) {
        const id = identifier.trim();
        if (id.includes('@')) {
            return { user: await this.prisma.user.findUnique({ where: { email: id } }), channel: 'email' as const, to: id };
        }
        return { user: await this.prisma.user.findFirst({ where: { phone: id } }), channel: 'whatsapp' as const, to: id };
    }

    /** Email/text a fresh login code if the identifier belongs to a user. */
    async request(identifier: string): Promise<{ sent: true }> {
        const { user, channel, to } = await this.findUser(identifier);
        if (user) {
            const recent = await this.prisma.otpCode.findFirst({
                where: { userId: user.id, consumedAt: null, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
            });
            if (!recent) {
                const code = randomInt(100000, 1000000).toString();
                await this.prisma.otpCode.create({
                    data: {
                        userId: user.id,
                        channel,
                        codeHash: this.hash(code),
                        expiresAt: new Date(Date.now() + CODE_TTL_MS),
                    },
                });
                await this.notifications.send({
                    organizationId: '',
                    userId: user.id,
                    channel,
                    to,
                    template: 'otp',
                    data: { code },
                });
            }
        }
        // Uniform response whether or not the identifier exists.
        return { sent: true };
    }

    /** Exchange a valid code for a session (access + refresh tokens). */
    async verify(identifier: string, code: string) {
        const { user } = await this.findUser(identifier);
        if (!user) throw new UnauthorizedException('Invalid or expired code');

        const otp = await this.prisma.otpCode.findFirst({
            where: { userId: user.id, consumedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        if (!otp || otp.expiresAt < new Date()) {
            throw new UnauthorizedException('Invalid or expired code');
        }
        if (otp.attempts >= MAX_ATTEMPTS) {
            throw new UnauthorizedException('Too many attempts; request a new code');
        }

        if (otp.codeHash !== this.hash(code.trim())) {
            await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
            throw new UnauthorizedException('Invalid or expired code');
        }

        // Correct: consume the code and start a session.
        await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
        const accessToken = await this.auth.signAccessToken(user.id);
        const refreshToken = await this.refreshTokens.issue(user.id);
        this.log.log(`otp login for user ${user.id}`);
        return { accessToken, refreshToken, userId: user.id };
    }
}
