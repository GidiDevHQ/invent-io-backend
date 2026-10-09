import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenService } from './refresh-token.service';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwt: JwtService,
        private refreshTokens: RefreshTokenService
    ) {}

    async register(dto: RegisterDto) {
        const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existing) {
            throw new ConflictException('Email already registered');
        }

        const passwordHash = await argon2.hash(dto.password);
        const result = await this.prisma.$transaction(async (tx) => {
            const org = await tx.organization.create({
                data: { name: dto.businessName },
            });

            const branch = await tx.branch.create({
                data: { organizationId: org.id, name: 'Main' },
            });

            const user = await tx.user.create({
                data: { name: dto.name, email: dto.email, passwordHash }
            });

            const ownerRole =  await tx.role.upsert({
                where: { name: 'OWNER' },
                update: {},
                create: { name: 'OWNER', permissions: ['*'] }
            });

            const membership = await tx.membership.create({
                data: {
                    userId: user.id,
                    organizationId: org.id,
                    branchId: null,
                    roleId: ownerRole.id
                },
            });

            return { org, branch, user, membership }
        });

        const accessToken = await this.signAccessToken(result.user.id);
        const refreshToken = await this.refreshTokens.issue(result.user.id);
        return { 
            accessToken, 
            refreshToken, 
            organizationId: result.org.id, 
            userId: result.user.id,
        };
    }

    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({where: { email: dto.email }});
        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const passwordValid = await argon2.verify(user.passwordHash, dto.password);
        if (!passwordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const accessToken = await this.signAccessToken(user.id);
        const refreshToken = await this.refreshTokens.issue(user.id);
        return {
            accessToken,
            refreshToken,
            userId: user.id
        };
    }

    private async resolveActiveOrganizationId(userId: string): Promise<string | null> {
        // A user may belong to several organizations; pick deterministically
        // (earliest membership) so tenant scoping is never arbitrary.
        const membership = await this.prisma.membership.findFirst({
            where: { userId },
            orderBy: { id: 'asc' },
            select: { organizationId: true },
        });
        return membership?.organizationId ?? null;
    }

    async signAccessToken(userId: string): Promise<string> {
        const organizationId = await this.resolveActiveOrganizationId(userId);
        return this.jwt.sign({ sub: userId, org: organizationId });
    }
}