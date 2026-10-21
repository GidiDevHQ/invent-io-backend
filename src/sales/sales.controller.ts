import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guards';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { PermissionGuard } from '../tenancy/permission.guard';
import { RequirePermission } from '../tenancy/require-permission.decorator';
import { Tenant } from '../tenancy/tenant.decorator';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { SalesService } from './sales.service';
import { AllocatePaymentDto } from './dto/allocate-payment.dto';

@ApiTags('sales')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
export class SalesController {
    constructor(private readonly sales: SalesService) {}

    @Post('payments/:id/match')
    @RequirePermission('sales.allocate')
    @ApiOperation({ summary: 'Allocate a confirmed payment to the items sold (creates a sale)' })
    match(
        @Tenant() tenant: TenantContext,
        @Param('id') paymentId: string,
        @Body() dto: AllocatePaymentDto,
    ) {
        return this.sales.allocate(tenant, paymentId, dto);
    }
}
