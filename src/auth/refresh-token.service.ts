import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createHash, randomUUID } from "crypto";

@Injectable()
export class RefreshTokenService {
    constructor(private prisma: PrismaService) {}

    private hash(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    async issue(userId: string) {
        const rawToken = randomUUID() + randomUUID();

        const familyId = randomUUID();

        await this.prisma.refreshToken.create({
            data: {
                userId,
                familyId,
                tokenHash: this.hash(rawToken),
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
            },
        });

        return rawToken;
    }

    async rotate(rawToken: string) {
        const tokenHash = this.hash(rawToken);
        const existing = await this.prisma.refreshToken.findUnique({
            where: { tokenHash },
        });

        if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
            throw new UnauthorizedException('Invalid refresh token');
        }

        if (existing.usedAt) {
            await this.prisma.refreshToken.updateMany({
                where: { familyId: existing.familyId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
            throw new UnauthorizedException('Refresh token reuse detected - session revoked');
        }

        const newRawToken = randomUUID() + randomUUID();
        const newTokenHash = this.hash(newRawToken);

        await this.prisma.$transaction([
            this.prisma.refreshToken.update({
                where: { id: existing.id },
                data: { usedAt: new Date() },
            }),
            this.prisma.refreshToken.create({
                data: {
                    userId: existing.userId,
                    familyId: existing.familyId,
                    tokenHash: newTokenHash,
                    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
                },
            }),
        ]);
        return { userId: existing.userId, newRawToken };
    }

    async revokeFamily(familyId: string) {
        await this.prisma.refreshToken.updateMany({
            where: { familyId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }

    async revokedByRawToken(rawToken: string) {
        const existing = await this.prisma.refreshToken.findUnique({
            where: { tokenHash: this.hash(rawToken) },
        });
        if (existing) {
            await this.revokeFamily(existing.familyId);
        }
    }
}