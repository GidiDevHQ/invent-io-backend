import { Module } from "@nestjs/common";
import { PaystackWebhookController } from "./webhooks/paystack-webhook.controller";
import { WebhookIngestService } from "./webhooks/webhooks-ingest.service";
import { WebhookWorkerService } from "./webhooks/webhooks-worker.service";

@Module({
    controllers: [PaystackWebhookController],
    providers: [WebhookIngestService, WebhookWorkerService]
})
export class PaymentsModule {}