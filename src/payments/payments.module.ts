import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { OutboxModule } from "../outbox/outbox.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { ManagedPaymentAccountController } from "./managed-payment-account.controller";
import { ManagedPaymentAccountService } from "./managed-payment-account.service";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import {
    createPaystackManagedClient,
    PAYSTACK_MANAGED_CLIENT_FACTORY,
} from "./paystack-managed.client.factory";
import { PaystackWebhookController } from "./webhooks/paystack-webhook.controller";
import { WebhookIngestService } from "./webhooks/webhooks-ingest.service";
import { WebhookProcessorService } from "./webhooks/webhook-processor.service";
import { WebhookWorkerService } from "./webhooks/webhooks-worker.service";

@Module({
    imports: [AuditModule, OutboxModule, TenancyModule],
    controllers: [PaystackWebhookController, ManagedPaymentAccountController, PaymentsController],
    providers: [
        WebhookIngestService,
        WebhookProcessorService,
        WebhookWorkerService,
        ManagedPaymentAccountService,
        PaymentsService,
        {
            provide: PAYSTACK_MANAGED_CLIENT_FACTORY,
            useValue: createPaystackManagedClient,
        },
    ],
})
export class PaymentsModule {}