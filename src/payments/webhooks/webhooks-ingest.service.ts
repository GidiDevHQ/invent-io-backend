import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { decryptSecret } from "../credentials-crypto";
import { verifyPaystackSignature } from "../paystack-signature";

export type IngestOutcome = 'ACCEPTED' | 'DUPLICATE' | 'QUARANTINED' | 'REJECTED';
const MAX_STORED_BODY_BYTES = 64 * 1024;
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const WEBHOOK_DEDUPE_CONSTRAINT = 'WebhookEvent_paymentAccountId_dedupeKey_key';

function isDuplicateWebhookEvent(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const prismaError = error as { code?: unknown; meta?: unknown };
    if (prismaError.code !== 'P2002' || typeof prismaError.meta !== 'object' || prismaError.meta === null) {
        return false;
    }

    const meta = prismaError.meta as Record<string, unknown>;
    const target = meta.target;
    if (
        (Array.isArray(target) && (target.includes('dedupeKey') || target.includes('platformDedupeKey'))) ||
        (typeof target === 'string' && (target.includes('dedupeKey') || target.includes('platformDedupeKey')))
    ) {
        return true;
    }

    const adapterError = meta.driverAdapterError;
    if (typeof adapterError !== 'object' || adapterError === null) return false;
    const cause = (adapterError as Record<string, unknown>).cause;
    if (typeof cause !== 'object' || cause === null) return false;
    const constraint = (cause as Record<string, unknown>).constraint;
    return (
        typeof constraint === 'object' &&
        constraint !== null &&
        ((constraint as Record<string, unknown>).index === WEBHOOK_DEDUPE_CONSTRAINT ||
            (constraint as Record<string, unknown>).index === 'WebhookEvent_platformDedupeKey_key')
    );
}

@Injectable()
export class WebhookIngestService {
    private readonly log = new Logger(WebhookIngestService.name)
    constructor(private readonly prisma: PrismaService) {}

    async ingestPlatformPaystack(params: {
        rawBody: Buffer;
        signature: string | undefined;
        correlationId?: string;
    }): Promise<IngestOutcome> {
        const secret = process.env.PAYSTACK_PLATFORM_TEST_SECRET_KEY;
        if (!secret || !secret.startsWith('sk_test_')) {
            throw new Error('PAYSTACK_PLATFORM_TEST_SECRET_KEY must be configured with a test key');
        }

        const correlationId = params.correlationId ?? randomUUID();
        const bodyText = params.rawBody.toString('utf-8');
        const valid = verifyPaystackSignature(params.rawBody, params.signature, secret);
        let eventType = 'unknown';
        let reference = '';
        let payload: unknown;

        try {
            const parsed = JSON.parse(bodyText);
            payload = parsed;
            eventType = typeof parsed?.event === 'string' ? parsed.event : 'unknown';
            reference = typeof parsed?.data?.reference === 'string' ? parsed.data.reference : '';
        } catch {
            // Keep the signed raw body for processor quarantine and diagnosis.
        }

        const dedupeKey = sha256(`${eventType}:${reference}:${bodyText}`);
        try {
            await this.prisma.webhookEvent.create({
                data: {
                    paymentAccountId: null,
                    eventType,
                    ...(valid && payload !== undefined ? { payload: payload as any } : {}),
                    rawBody: bodyText,
                    signatureValid: valid,
                    dedupeKey,
                    platformDedupeKey: sha256(bodyText),
                    status: valid ? 'RECEIVED' : 'REJECTED',
                    correlationId,
                },
            });
        } catch (error: unknown) {
            if (isDuplicateWebhookEvent(error)) {
                return valid ? 'DUPLICATE' : 'REJECTED';
            }
            throw error;
        }

        if (!valid) {
            this.log.warn(`Platform webhook received with invalid signature, correlationId=${correlationId}`);
            return 'REJECTED';
        }
        return 'ACCEPTED';
    }

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
            } catch (error: unknown) {
                if (!isDuplicateWebhookEvent(error)) throw error;
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
        } catch (error: unknown) {
            if (isDuplicateWebhookEvent(error)) {
                this.log.warn(`Duplicate webhook event for account ${account.id}, eventType ${eventType}, reference ${reference}`);
                return 'DUPLICATE';
            }
            throw error;
        }
        return 'ACCEPTED'
    }
}