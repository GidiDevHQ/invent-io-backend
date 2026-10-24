import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guards';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { PermissionGuard } from '../tenancy/permission.guard';
import { RequirePermission } from '../tenancy/require-permission.decorator';
import { Tenant } from '../tenancy/tenant.decorator';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { SalesService } from './sales.service';
import { RefundService } from './refund.service';
import { AllocatePaymentDto } from './dto/allocate-payment.dto';
import { RefundDto } from './dto/refund.dto';

@ApiTags('sales')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
export class SalesController {
    constructor(
        private readonly sales: SalesService,
        private readonly refunds: RefundService,
    ) {}

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

    @Post('sales/:id/refund')
    @RequirePermission('sales.refund')
    @ApiOperation({
        summary: 'Refund a sale (full or partial): restores stock and records the refund',
    })
    refund(
        @Tenant() tenant: TenantContext,
        @Param('id') saleId: string,
        @Body() dto: RefundDto,
    ) {
        return this.refunds.refund(tenant, saleId, dto);
    }
}
