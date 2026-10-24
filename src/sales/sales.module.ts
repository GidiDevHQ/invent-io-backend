import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { RefundService } from './refund.service';

@Module({
    imports: [AuditModule, InventoryModule], // OutboxModule is global
    controllers: [SalesController],
    providers: [SalesService, RefundService],
    exports: [SalesService, RefundService],
})
export class SalesModule {}
