import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guards';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { PermissionGuard } from '../tenancy/permission.guard';
import { RequirePermission } from '../tenancy/require-permission.decorator';
import { Tenant } from '../tenancy/tenant.decorator';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { StockService } from './stock.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { SetThresholdDto } from './dto/set-threshold.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
export class InventoryController {
    constructor(private readonly stock: StockService) {}

    @Post('stock/adjustments')
    @RequirePermission('stock.adjust')
    @ApiOperation({ summary: 'Restock or adjust stock with a reason' })
    adjust(@Tenant() tenant: TenantContext, @Body() dto: AdjustStockDto) {
        return this.stock.adjust(tenant, dto);
    }

    @Get('branches/:id/stock')
    @RequirePermission('stock.read')
    @ApiOperation({ summary: 'Stock levels for a branch' })
    branchStock(@Tenant() tenant: TenantContext, @Param('id') branchId: string) {
        return this.stock.getBranchStock(tenant, branchId);
    }

    @Get('branches/:id/low-stock')
    @RequirePermission('stock.read')
    @ApiOperation({ summary: 'Items at or below their low-stock threshold' })
    lowStock(@Tenant() tenant: TenantContext, @Param('id') branchId: string) {
        return this.stock.getLowStock(tenant, branchId);
    }

    @Patch('branches/:branchId/stock/:productId')
    @RequirePermission('stock.adjust')
    @ApiOperation({ summary: 'Set the low-stock threshold for a product at a branch' })
    setThreshold(
        @Tenant() tenant: TenantContext,
        @Param('branchId') branchId: string,
        @Param('productId') productId: string,
        @Body() dto: SetThresholdDto,
    ) {
        return this.stock.setThreshold(tenant, branchId, productId, dto.lowStockThreshold);
    }
}
