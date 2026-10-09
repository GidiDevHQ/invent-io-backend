import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The tenant context resolved by TenantContextGuard and attached to the
 * request. Every tenant-scoped query must be scoped by `organizationId`.
 */
export interface TenantContext {
    userId: string;
    organizationId: string;
    branchId: string | null;
    membershipId: string;
    roleId: string;
    permissions: string[];
}

/**
 * Injects the resolved TenantContext into a controller handler.
 * Requires TenantContextGuard to have run (it sets `req.tenant`).
 */
export const Tenant = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): TenantContext => {
        const req = ctx.switchToHttp().getRequest();
        return req.tenant as TenantContext;
    },
);
