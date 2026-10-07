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

        const accessToken = this.signToken(result.user.id);
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

        const accessToken = this.signToken(user.id);
        const refreshToken = await this.refreshTokens.issue(user.id);
        return { 
            accessToken, 
            refreshToken, 
            userId: user.id 
        };
    }

    signToken(userId: string): string {
        return this.jwt.sign({ sub: userId })
    }
}