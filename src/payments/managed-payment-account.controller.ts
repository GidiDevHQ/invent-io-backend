import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guards';
import { PermissionGuard } from '../tenancy/permission.guard';
import { RequirePermission } from '../tenancy/require-permission.decorator';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { Tenant } from '../tenancy/tenant.decorator';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { CreateManagedPaymentAccountDto } from './dto/create-managed-payment-account.dto';
import { ManagedPaymentAccountService } from './managed-payment-account.service';

@ApiTags('managed payments')
@ApiBearerAuth()
@Controller('payments/managed-account')
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
export class ManagedPaymentAccountController {
    constructor(private readonly managedPayments: ManagedPaymentAccountService) {}

    @Get()
    @RequirePermission('payments.manage')
    @ApiOperation({ summary: 'Get this organization’s managed Paystack account and DVA' })
    get(@Tenant() tenant: TenantContext) {
        return this.managedPayments.get(tenant);
    }

    @Post()
    @RequirePermission('payments.manage')
    @ApiOperation({ summary: 'Provision a Paystack test subaccount and linked DVA' })
    provision(@Tenant() tenant: TenantContext, @Body() dto: CreateManagedPaymentAccountDto) {
        return this.managedPayments.provision(tenant, dto);
    }
}
