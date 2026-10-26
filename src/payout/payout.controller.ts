import { Body, Controller, Delete, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guards';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { PermissionGuard } from '../tenancy/permission.guard';
import { RequirePermission } from '../tenancy/require-permission.decorator';
import { Tenant } from '../tenancy/tenant.decorator';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { PayoutAccountService } from './payout-account.service';
import { UpsertPayoutAccountDto } from './dto/payout-account.dto';

@ApiTags('payout')
@ApiBearerAuth()
@Controller('payout-account')
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
export class PayoutController {
    constructor(private readonly payout: PayoutAccountService) {}

    @Get()
    @RequirePermission('payout.manage')
    @ApiOperation({ summary: 'Get the org payout account (last 4 digits only)' })
    get(@Tenant() tenant: TenantContext) {
        return this.payout.get(tenant);
    }

    @Put()
    @RequirePermission('payout.manage')
    @ApiOperation({ summary: 'Set or replace the org payout bank account' })
    upsert(@Tenant() tenant: TenantContext, @Body() dto: UpsertPayoutAccountDto) {
        return this.payout.upsert(tenant, dto);
    }

    @Delete()
    @HttpCode(200)
    @RequirePermission('payout.manage')
    @ApiOperation({ summary: 'Remove the org payout account' })
    remove(@Tenant() tenant: TenantContext) {
        return this.payout.remove(tenant);
    }
}
