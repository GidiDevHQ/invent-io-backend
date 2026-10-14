import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryController } from './inventory.controller';
import { StockService } from './stock.service';

@Module({
    imports: [AuditModule],
    controllers: [InventoryController],
    providers: [StockService],
    exports: [StockService], // sales will call StockService.apply within its transaction
})
export class InventoryModule {}
