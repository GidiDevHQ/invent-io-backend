import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guards";
import { PrismaService } from "../prisma/prisma.service";
import { TenantContextGuard } from "./tenant-context.guard";
import { Tenant, type TenantContext } from "./tenant.decorator";
import { branchesFor } from "./branches";

@Controller()
@UseGuards(JwtAuthGuard, TenantContextGuard)
@ApiBearerAuth()
export class TenancyController {
    constructor(private readonly prisma: PrismaService) {}

    // Any member may read their own context (not only owners).
    @Get('tenancy/me')
    @ApiOperation({ summary: 'Current tenant context, with the branches this member can use' })
    async me(@Tenant() tenant: TenantContext) {
        return { ...tenant, branches: await branchesFor(this.prisma, tenant) };
    }

    @Get('branches')
    @ApiOperation({ summary: 'Active branches this member can use ([{ id, name }])' })
    branches(@Tenant() tenant: TenantContext) {
        return branchesFor(this.prisma, tenant);
    }
}
