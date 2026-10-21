import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher';
import { NotificationsController } from './notifications.controller';
import { SimulatedChannel } from './channels/simulated.channel';
import { WhatsAppChannel } from './channels/whatsapp.channel';
import { EmailChannel } from './channels/email.channel';

@Module({
    controllers: [NotificationsController],
    providers: [NotificationService, NotificationDispatcher, SimulatedChannel, WhatsAppChannel, EmailChannel],
    exports: [NotificationService, NotificationDispatcher], // the worker's outbox consumer uses the dispatcher
})
export class NotificationsModule {}
