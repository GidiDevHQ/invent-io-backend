
import { Module } from '@nestjs/common';
import { TenancyController } from './tenancy.controller';
import { TenantContextGuard } from './tenant-context.guard';
import { PermissionGuard } from './permission.guard';

@Module({
  controllers: [TenancyController],
  providers: [TenantContextGuard, PermissionGuard],
  exports: [TenantContextGuard, PermissionGuard],
})
export class TenancyModule {}