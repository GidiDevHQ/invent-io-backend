import {
    CanActivate,
    ExecutionContext,
    Injectable,
    ForbiddenException,
    UnauthorizedException
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantContextGuard implements CanActivate {
    constructor(private prisma: PrismaService) {}

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const req = ctx.switchToHttp().getRequest();
        const userId = req.user?.userId;

        if (!userId) {
            throw new UnauthorizedException('User is not authenticated');
        }

        const membership = await this.prisma.membership.findFirst({
            where: { userId },
            include: { role: true, organization: true },
        });

        if (!membership) {
            throw new ForbiddenException('No organization membership found');
        }

        req.tenant = {
            userId,
            organizationId: membership.organization.id,
            branchId: membership.branchId,
            membershipId: membership.id,
            roleId: membership.roleId,
            permissions: membership.role.permissions,
        };

        return true;
    }
}