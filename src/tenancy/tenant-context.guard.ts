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
        const organizationId = req.user?.organizationId;

        if (!userId) {
            throw new UnauthorizedException('User is not authenticated');
        }

        // Prefer the active organization carried in the token; fall back to the
        // earliest membership deterministically so scoping is never arbitrary.
        const membership = await this.prisma.membership.findFirst({
            where: organizationId ? { userId, organizationId } : { userId },
            orderBy: { id: 'asc' },
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