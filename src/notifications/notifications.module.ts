import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { SimulatedChannel } from './channels/simulated.channel';
import { WhatsAppChannel } from './channels/whatsapp.channel';
import { EmailChannel } from './channels/email.channel';

@Module({
    controllers: [NotificationsController],
    providers: [NotificationService, SimulatedChannel, WhatsAppChannel, EmailChannel],
    exports: [NotificationService], // the worker's outbox consumer will use this later
})
export class NotificationsModule {}
