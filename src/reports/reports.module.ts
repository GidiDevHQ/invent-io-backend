import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { WeeklySummaryService } from './weekly-summary.service';

@Module({
    imports: [NotificationsModule], // weekly summary dispatches via NotificationService + push
    controllers: [ReportsController],
    providers: [ReportsService, WeeklySummaryService],
    exports: [ReportsService, WeeklySummaryService], // the worker's scheduler resolves WeeklySummaryService
})
export class ReportsModule {}
