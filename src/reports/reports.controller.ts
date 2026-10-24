import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guards';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { PermissionGuard } from '../tenancy/permission.guard';
import { RequirePermission } from '../tenancy/require-permission.decorator';
import { Tenant } from '../tenancy/tenant.decorator';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
export class ReportsController {
    constructor(private readonly reports: ReportsService) {}

    @Get('dashboard/summary')
    @RequirePermission('reports.view')
    @ApiOperation({ summary: "Today's sales count, revenue, margin and low-stock count" })
    summary(@Tenant() tenant: TenantContext, @Query('date') date?: string) {
        return this.reports.dashboardSummary(tenant, date);
    }

    @Get('dashboard/low-stock')
    @RequirePermission('reports.view')
    @ApiOperation({ summary: 'Items at or below their low-stock threshold' })
    lowStock(@Tenant() tenant: TenantContext) {
        return this.reports.lowStock(tenant);
    }

    @Get('reports/sales')
    @RequirePermission('reports.view')
    @ApiOperation({ summary: 'Filtered, cursor-paginated sales list' })
    sales(
        @Tenant() tenant: TenantContext,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('branchId') branchId?: string,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ) {
        return this.reports.salesReport(tenant, {
            from,
            to,
            branchId,
            limit: limit ? Number(limit) : undefined,
            cursor,
        });
    }
}
