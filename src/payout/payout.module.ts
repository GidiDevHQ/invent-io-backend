import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PayoutController } from './payout.controller';
import { PayoutAccountService } from './payout-account.service';

@Module({
    imports: [AuditModule],
    controllers: [PayoutController],
    providers: [PayoutAccountService],
    exports: [PayoutAccountService],
})
export class PayoutModule {}
