import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { OutboxModule } from "../outbox/outbox.module";
import { PaystackWebhookController } from "./webhooks/paystack-webhook.controller";
import { WebhookIngestService } from "./webhooks/webhooks-ingest.service";
import { WebhookProcessorService } from "./webhooks/webhook-processor.service";
import { WebhookWorkerService } from "./webhooks/webhooks-worker.service";

@Module({
    imports: [AuditModule, OutboxModule],
    controllers: [PaystackWebhookController],
    providers: [WebhookIngestService, WebhookProcessorService, WebhookWorkerService]
})
export class PaymentsModule {}