import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guards';
import { PermissionGuard } from '../tenancy/permission.guard';
import { RequirePermission } from '../tenancy/require-permission.decorator';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { Tenant } from '../tenancy/tenant.decorator';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
export class PaymentsController {
    constructor(private readonly payments: PaymentsService) {}

    @Get()
    @RequirePermission('sales.allocate')
    @ApiOperation({ summary: 'List succeeded payments that have not been itemized' })
    @ApiQuery({ name: 'status', required: false, enum: ['SUCCEEDED'] })
    @ApiQuery({ name: 'branchId', required: false })
    @ApiQuery({ name: 'limit', required: false })
    @ApiQuery({ name: 'cursor', required: false })
    listUnallocated(
        @Tenant() tenant: TenantContext,
        @Query('status') status?: string,
        @Query('branchId') branchId?: string,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ) {
        return this.payments.listUnallocated(tenant, {
            status,
            branchId,
            limit: limit ? Number(limit) : undefined,
            cursor,
        });
    }

    @Post('manual')
    @RequirePermission('sales.allocate')
    @ApiOperation({ summary: 'Record a cash payment for the itemization flow' })
    createManual(@Tenant() tenant: TenantContext, @Body() dto: CreateManualPaymentDto) {
        return this.payments.createManual(tenant, dto);
    }
}
