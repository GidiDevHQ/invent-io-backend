import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from './tenant.decorator';

export interface BranchSummary {
    id: string;
    name: string;
}

/**
 * Active branches the tenant can work in: all of the organization's for an
 * org-wide member (owner, branchId null), only their own for a branch-scoped one.
 */
export function branchesFor(prisma: PrismaService, tenant: TenantContext): Promise<BranchSummary[]> {
    return prisma.branch.findMany({
        where: {
            organizationId: tenant.organizationId,
            active: true,
            ...(tenant.branchId ? { id: tenant.branchId } : {}),
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
    });
}
