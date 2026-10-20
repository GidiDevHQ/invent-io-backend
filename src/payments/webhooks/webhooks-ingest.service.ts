import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { decryptSecret } from "../credentials-crypto";
import { verifyPaystackSignature } from "../paystack-signature";

export type IngestOutcome = 'ACCEPTED' | 'DUPLICATE' | 'QUARANTINED' | 'REJECTED';
const MAX_STORED_BODY_BYTES = 64 * 1024;
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class WebhookIngestService {
    private readonly log = new Logger(WebhookIngestService.name)
    constructor(private readonly prisma: PrismaService) {}

    async ingestPaystack(params: {
        integrationToken: string;
        rawBody: Buffer;
        signature: string | undefined;
        correlationId?: string;
    }): Promise<IngestOutcome> {
        const correlationId = params.correlationId ?? randomUUID();
        const bodyText = params.rawBody.toString('utf-8');
        const storedBody = params.rawBody.length > MAX_STORED_BODY_BYTES 
        ? bodyText.slice(0, MAX_STORED_BODY_BYTES) + '...[truncated]'
        : bodyText;

        const account = await this.prisma.paymentAccount.findUnique({
            where: { integrationTokenHash: sha256(params.integrationToken) },
        });

        if (!account || account.status !== 'ACTIVE') {
            await this.prisma.webhookEvent.create({
                data: {
                    paymentAccountId: null,
                    eventType: 'unknown',
                    rawBody: storedBody,
                    signatureValid: false,
                    dedupeKey: sha256(params.rawBody),
                    status: 'QUARANTINED',
                    correlationId,
                },
            });
            this.log.warn(`Webhook received for unknown or disabled account, correlationId=${correlationId}, integrationToken=${sha256(params.integrationToken)}`);
            return 'QUARANTINED'
        }

        const secret = decryptSecret(account.secretCiphertext);
        const valid = verifyPaystackSignature(params.rawBody, params.signature, secret);

        if (!valid) {
            try {
                await this.prisma.webhookEvent.create({
                    data: {
                        paymentAccountId: account.id,
                        eventType: 'unknown',
                        rawBody: storedBody,
                        signatureValid: false,
                        dedupeKey: sha256(params.rawBody),
                        status: 'REJECTED',
                        correlationId,
                    },
                });
            } catch (e: any) {
                if (e?.code !== 'P2002' || !e.meta?.target?.includes('dedupeKey')) {
                    throw e;
                }
            }
            this.log.warn(`Webhook received with invalid signature, correlationId=${correlationId}, integrationToken=${sha256(params.integrationToken)}`);
            return 'REJECTED'
        }

        let eventType = 'unknown';
        let reference = '';
        let payload: unknown = undefined;

        try {
            const parsed = JSON.parse(bodyText);
            payload = parsed;
            eventType = typeof parsed?.event === 'string' ? parsed.event  : 'unknown';
            reference = typeof parsed?.data?.reference === 'string' ? parsed.data.reference : '';
        } catch {
            // signed but not JSON: still persist it, the worker will mark it FAILED
        }

        const dedupeKey = sha256(`${eventType}:${reference}:${bodyText}`);

        try { 
            await this.prisma.webhookEvent.create({
                data: {
                    paymentAccountId: account.id,
                    eventType,
                    payload: payload as any,
                    rawBody: bodyText,
                    signatureValid: true,
                    dedupeKey,
                    status: 'RECEIVED',
                    correlationId,
                }
            });
        } catch (e: any) {
            if (e?.code === 'P2002' && e.meta?.target?.includes('dedupeKey')) {
                this.log.warn(`Duplicate webhook event for account ${account.id}, eventType ${eventType}, reference ${reference}`);
                return 'DUPLICATE';
            }
            throw e;
        }
        return 'ACCEPTED'
    }
}