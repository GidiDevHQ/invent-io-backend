import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { OutboxService } from '../../outbox/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';

type ChargeSuccess = {
    amount: number;
    channel: string;
    currency: string;
    id?: string | number;
    paid_at?: string;
    reference: string;
    status: 'success';
    transaction_date?: string;
};

type NormalizedPayment = {
    amountMinor: bigint;
    currency: string;
    method: string;
    occurredAt: Date;
    providerPaymentId: string | null;
    providerReference: string;
};

class InvalidWebhookEventError extends Error {}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
}

function normalizeChargeSuccess(
    rawBody: string,
    eventType: string,
    receivedAt: Date,
): NormalizedPayment {
    if (eventType !== 'charge.success') {
        throw new InvalidWebhookEventError(`Unsupported Paystack event: ${eventType}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawBody);
    } catch {
        throw new InvalidWebhookEventError('Webhook body is not valid JSON');
    }

    const root = asRecord(parsed);
    const data = asRecord(root?.data);
    if (
        root?.event !== 'charge.success' ||
        data?.status !== 'success' ||
        typeof data.reference !== 'string' ||
        data.reference.trim() === '' ||
        typeof data.amount !== 'number' ||
        !Number.isSafeInteger(data.amount) ||
        data.amount <= 0 ||
        typeof data.currency !== 'string' ||
        !/^[A-Z]{3}$/.test(data.currency) ||
        typeof data.channel !== 'string' ||
        data.channel.trim() === ''
    ) {
        throw new InvalidWebhookEventError('Webhook does not contain a valid successful charge');
    }

    const charge = data as unknown as ChargeSuccess;
    const dateValue = charge.paid_at ?? charge.transaction_date;
    const occurredAt = dateValue ? new Date(dateValue) : receivedAt;
    if (Number.isNaN(occurredAt.getTime())) {
        throw new InvalidWebhookEventError('Webhook contains an invalid payment date');
    }

    const providerPaymentId =
        typeof charge.id === 'number' && Number.isSafeInteger(charge.id)
            ? String(charge.id)
            : typeof charge.id === 'string' && charge.id.trim() !== ''
              ? charge.id
              : null;

    return {
        amountMinor: BigInt(charge.amount),
        currency: charge.currency,
        method: charge.channel,
        occurredAt,
        providerPaymentId,
        providerReference: charge.reference,
    };
}

@Injectable()
export class WebhookProcessorService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly outbox: OutboxService,
    ) {}

    async process(eventId: string): Promise<void> {
        const event = await this.prisma.webhookEvent.findUniqueOrThrow({
            where: { id: eventId },
            include: { paymentAccount: true },
        });

        if (!event.signatureValid || !event.paymentAccount) {
            await this.quarantine(event.id, 'Event is not associated with a verified payment account');
            return;
        }

        let payment: NormalizedPayment;
        try {
            payment = normalizeChargeSuccess(event.rawBody, event.eventType, event.receivedAt);
        } catch (error) {
            if (!(error instanceof InvalidWebhookEventError)) throw error;
            await this.quarantine(event.id, error.message);
            return;
        }

        try {
            await this.prisma.$transaction(async (tx) => {
                const created = await tx.payment.create({
                    data: {
                        paymentAccountId: event.paymentAccountId!,
                        organizationId: event.paymentAccount!.organizationId,
                        branchId: event.paymentAccount!.branchId,
                        providerReference: payment.providerReference,
                        providerPaymentId: payment.providerPaymentId,
                        amountMinor: payment.amountMinor,
                        currency: payment.currency,
                        method: payment.method,
                        status: 'SUCCEEDED',
                        occurredAt: payment.occurredAt,
                    },
                });

                await this.audit.record(tx, {
                    organizationId: event.paymentAccount!.organizationId,
                    action: 'payment.confirmed',
                    entity: 'Payment',
                    entityId: created.id,
                    after: {
                        paymentAccountId: event.paymentAccountId,
                        providerReference: payment.providerReference,
                        amountMinor: payment.amountMinor.toString(),
                        currency: payment.currency,
                        status: 'SUCCEEDED',
                    },
                });

                await this.outbox.enqueue(tx, {
                    type: 'payment.confirmed',
                    organizationId: event.paymentAccount!.organizationId,
                    payload: {
                        paymentId: created.id,
                        organizationId: event.paymentAccount!.organizationId,
                        branchId: event.paymentAccount!.branchId,
                        reference: payment.providerReference,
                        amountMinor: payment.amountMinor.toString(),
                        currency: payment.currency,
                    },
                });

                await tx.webhookEvent.update({
                    where: { id: event.id },
                    data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
                });
            });
        } catch (error) {
            if (!this.isUniquePaymentReferenceError(error)) throw error;
            await this.markDuplicatePaymentEventProcessed(event.id, payment, event.paymentAccountId!);
        }
    }

    private async markDuplicatePaymentEventProcessed(
        eventId: string,
        payment: NormalizedPayment,
        paymentAccountId: string,
    ): Promise<void> {
        const existing = await this.prisma.payment.findUnique({
            where: {
                paymentAccountId_providerReference: {
                    paymentAccountId,
                    providerReference: payment.providerReference,
                },
            },
        });

        if (
            !existing ||
            existing.amountMinor !== payment.amountMinor ||
            existing.currency !== payment.currency ||
            existing.method !== payment.method ||
            existing.status !== 'SUCCEEDED'
        ) {
            await this.quarantine(eventId, 'Payment reference was reused with conflicting payment details');
            return;
        }

        await this.prisma.webhookEvent.update({
            where: { id: eventId },
            data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
        });
    }

    private async quarantine(eventId: string, reason: string): Promise<void> {
        await this.prisma.webhookEvent.update({
            where: { id: eventId },
            data: {
                status: 'QUARANTINED',
                processedAt: new Date(),
                lastError: reason.slice(0, 500),
            },
        });
    }

    private isUniquePaymentReferenceError(error: unknown): boolean {
        const prismaError = error as { code?: string; meta?: { target?: string[] } };
        return (
            prismaError.code === 'P2002' &&
            prismaError.meta?.target?.includes('paymentAccountId') === true &&
            prismaError.meta?.target?.includes('providerReference') === true
        );
    }
}
