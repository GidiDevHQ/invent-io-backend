import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { EmailVerificationService } from './email-verification.service';

/**
 * Self-service credential changes for a logged-in user. Both changing the
 * password and changing the email require re-entering the current password —
 * a stolen access token alone can't silently take over the account. Changing
 * the password revokes all sessions; changing the email marks it unverified and
 * sends a fresh verification link.
 */
@Injectable()
export class AccountCredentialsService {
    private readonly log = new Logger(AccountCredentialsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly refreshTokens: RefreshTokenService,
        private readonly emailVerification: EmailVerificationService,
    ) {}

    private async assertCurrentPassword(userId: string, currentPassword: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new UnauthorizedException('Not authenticated');
        const ok = await argon2.verify(user.passwordHash, currentPassword);
        if (!ok) throw new UnauthorizedException('Current password is incorrect');
        return user;
    }

    async changePassword(userId: string, currentPassword: string, newPassword: string) {
        const user = await this.assertCurrentPassword(userId, currentPassword);
        if (await argon2.verify(user.passwordHash, newPassword)) {
            throw new BadRequestException('New password must be different from the current one');
        }

        const passwordHash = await argon2.hash(newPassword);
        await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
        // Force every device to re-authenticate with the new password.
        await this.refreshTokens.revokeAllForUser(userId);
        this.log.log(`password changed for user ${userId}; sessions revoked`);
        return { changed: true };
    }

    async changeEmail(userId: string, currentPassword: string, newEmail: string) {
        const user = await this.assertCurrentPassword(userId, currentPassword);
        const email = newEmail.trim().toLowerCase();
        if (email === user.email.toLowerCase()) {
            throw new BadRequestException('New email must be different from the current one');
        }

        const taken = await this.prisma.user.findUnique({ where: { email } });
        if (taken) throw new ConflictException('Email already in use');

        const updated = await this.prisma.user.update({
            where: { id: userId },
            data: { email, emailVerified: false },
        });
        // The new address is unproven until the user follows the link.
        await this.emailVerification.issueAndSend({ id: updated.id, email: updated.email, name: updated.name });
        this.log.log(`email changed for user ${userId}; verification sent`);
        return { changed: true, verificationSent: true };
    }
}
