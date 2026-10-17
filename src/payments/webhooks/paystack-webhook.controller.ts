import { 
    BadRequestException,
    Controller,
    Headers,
    HttpCode,
    Param,
    Post,
    Req,
    UnauthorizedException
 } from "@nestjs/common";
 import type { RawBodyRequest } from "@nestjs/common";
 import type { Request } from "express";
 import { WebhookIngestService } from "./webhooks-ingest.service";

 @Controller('webhooks/paystack')
 export class PaystackWebhookController {
    constructor(private readonly ingest: WebhookIngestService) {}

    @Post(':integrationToken')
    @HttpCode(200)
    async receive(
        @Param('integrationToken') integrationToken: string,
        @Headers('x-paystack-signature') signature: string | undefined,
        @Headers('x-request-id') requestId: string | undefined,
        @Req() req: RawBodyRequest<Request>,
    ) {
        if (!req.rawBody) {
            throw new BadRequestException('Raw body unavailable');
        }

        const outcome = await this.ingest.ingestPaystack({
            integrationToken,
            rawBody: req.rawBody,
            signature,
            correlationId: requestId,
        });

        if (outcome === 'REJECTED' || outcome === 'QUARANTINED') throw new UnauthorizedException();
        return { received: true };
    }
 }
 