import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher';
import { NotificationsController } from './notifications.controller';
import { PushController } from './push.controller';
import { PushSubscriptionService } from './push-subscription.service';
import { SimulatedChannel } from './channels/simulated.channel';
import { WhatsAppChannel } from './channels/whatsapp.channel';
import { EmailChannel } from './channels/email.channel';
import { WebPushChannel } from './channels/webpush.channel';

@Module({
    controllers: [NotificationsController, PushController],
    providers: [
        NotificationService,
        NotificationDispatcher,
        PushSubscriptionService,
        SimulatedChannel,
        WhatsAppChannel,
        EmailChannel,
        WebPushChannel,
    ],
    exports: [NotificationService, NotificationDispatcher], // the worker's outbox consumer uses the dispatcher
})
export class NotificationsModule {}
