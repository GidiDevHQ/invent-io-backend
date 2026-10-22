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
    customerCode: string | null;
    receiverAccountNumber: string | null;
};

type PaymentContext = {
    organizationId: string;
    branchId: string | null;
    paymentAccountId: string | null;
    managedPaymentAccountId: string | null;
    dedicatedVirtualAccountId: string | null;
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
    const customer = asRecord(data.customer);
    const authorization = asRecord(data.authorization);

    return {
        amountMinor: BigInt(charge.amount),
        currency: charge.currency,
        method: charge.channel,
        occurredAt,
        providerPaymentId,
        providerReference: charge.reference,
        customerCode:
            typeof customer?.customer_code === 'string' && customer.customer_code.trim() !== ''
                ? customer.customer_code
                : null,
        receiverAccountNumber:
            typeof authorization?.receiver_bank_account_number === 'string' &&
            authorization.receiver_bank_account_number.trim() !== ''
                ? authorization.receiver_bank_account_number
                : null,
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

        if (!event.signatureValid) {
            await this.quarantine(event.id, 'Event signature has not been verified');
            return;
        }

        if (event.eventType === 'dedicatedaccount.assign.success') {
            if (event.paymentAccountId !== null) {
                await this.quarantine(event.id, 'DVA assignment events must use the verified platform webhook');
                return;
            }
            await this.activateDedicatedAccount(event.id, event.rawBody);
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

        const context = await this.resolvePaymentContext(event, payment);
        if (!context) {
            await this.quarantine(event.id, 'Verified webhook does not map to an active payment account or DVA');
            return;
        }

        try {
            await this.prisma.$transaction(async (tx) => {
                const created = await tx.payment.create({
                    data: {
                        paymentAccountId: context.paymentAccountId,
                        managedPaymentAccountId: context.managedPaymentAccountId,
                        dedicatedVirtualAccountId: context.dedicatedVirtualAccountId,
                        organizationId: context.organizationId,
                        branchId: context.branchId,
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
                    organizationId: context.organizationId,
                    action: 'payment.confirmed',
                    entity: 'Payment',
                    entityId: created.id,
                    after: {
                        paymentAccountId: context.paymentAccountId,
                        managedPaymentAccountId: context.managedPaymentAccountId,
                        dedicatedVirtualAccountId: context.dedicatedVirtualAccountId,
                        providerReference: payment.providerReference,
                        amountMinor: payment.amountMinor.toString(),
                        currency: payment.currency,
                        status: 'SUCCEEDED',
                    },
                });

                await this.outbox.enqueue(tx, {
                    type: 'payment.confirmed',
                    organizationId: context.organizationId,
                    payload: {
                        paymentId: created.id,
                        organizationId: context.organizationId,
                        branchId: context.branchId,
                        reference: payment.providerReference,
                        amountMinor: payment.amountMinor.toString(),
                        currency: payment.currency,
                        ...(context.dedicatedVirtualAccountId
                            ? { dedicatedVirtualAccountId: context.dedicatedVirtualAccountId }
                            : {}),
                    },
                });

                await tx.webhookEvent.update({
                    where: { id: event.id },
                    data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
                });
            });
        } catch (error) {
            if (!this.isUniquePaymentReferenceError(error)) throw error;
            await this.markDuplicatePaymentEventProcessed(event.id, payment, context);
        }
    }

    private async resolvePaymentContext(
        event: {
            paymentAccountId: string | null;
            paymentAccount: {
                id: string;
                organizationId: string;
                branchId: string | null;
                status: string;
            } | null;
        },
        payment: NormalizedPayment,
    ): Promise<PaymentContext | undefined> {
        if (payment.method !== 'dedicated_nuban') {
            if (!event.paymentAccount) return undefined;
            if (event.paymentAccount.status !== 'ACTIVE') return undefined;
            return {
                organizationId: event.paymentAccount.organizationId,
                branchId: event.paymentAccount.branchId,
                paymentAccountId: event.paymentAccountId,
                managedPaymentAccountId: null,
                dedicatedVirtualAccountId: null,
            };
        }

        const customerCode = payment.customerCode ?? undefined;
        const receiverAccountNumber = payment.receiverAccountNumber ?? undefined;
        if (!customerCode && !receiverAccountNumber) return undefined;

        const [byCustomerCode, byAccountNumber] = await Promise.all([
            customerCode
                ? this.prisma.dedicatedVirtualAccount.findUnique({
                      where: { providerCustomerCode: customerCode },
                      include: { managedPaymentAccount: true },
                  })
                : Promise.resolve(null),
            receiverAccountNumber
                ? this.prisma.dedicatedVirtualAccount.findUnique({
                      where: { accountNumber: receiverAccountNumber },
                      include: { managedPaymentAccount: true },
                  })
                : Promise.resolve(null),
        ]);

        if (
            (customerCode && !byCustomerCode) ||
            (receiverAccountNumber && !byAccountNumber) ||
            (byCustomerCode && byAccountNumber && byCustomerCode.id !== byAccountNumber.id)
        ) {
            return undefined;
        }

        const virtualAccount = byCustomerCode ?? byAccountNumber;
        if (
            !virtualAccount ||
            !['PENDING', 'ACTIVE'].includes(virtualAccount.status) ||
            !['PENDING', 'ACTIVE'].includes(virtualAccount.managedPaymentAccount.status)
        ) {
            return undefined;
        }

        return {
            organizationId: virtualAccount.managedPaymentAccount.organizationId,
            branchId: null,
            paymentAccountId: null,
            managedPaymentAccountId: virtualAccount.managedPaymentAccountId,
            dedicatedVirtualAccountId: virtualAccount.id,
        };
    }

    private async activateDedicatedAccount(eventId: string, rawBody: string): Promise<void> {
        let parsed: unknown;
        try {
            parsed = JSON.parse(rawBody);
        } catch {
            await this.quarantine(eventId, 'Assignment-success body is not valid JSON');
            return;
        }

        const root = asRecord(parsed);
        const data = asRecord(root?.data);
        if (root?.event !== 'dedicatedaccount.assign.success') {
            await this.quarantine(eventId, 'Assignment-success event body does not match event type');
            return;
        }

        const customerCode = paymentCustomerCode(data);
        if (!customerCode) {
            await this.quarantine(eventId, 'Assignment-success event has no customer_code');
            return;
        }

        const account = asRecord(data?.dedicated_account);
        const accountNumber =
            typeof account?.account_number === 'string' && account.account_number.trim() !== ''
                ? account.account_number
                : null;
        const virtualAccount = await this.prisma.dedicatedVirtualAccount.findUnique({
            where: { providerCustomerCode: customerCode },
            include: { managedPaymentAccount: true },
        });

        if (!virtualAccount) {
            await this.quarantine(eventId, 'Assignment-success event references an unknown customer');
            return;
        }
        if (accountNumber && accountNumber !== virtualAccount.accountNumber) {
            await this.quarantine(eventId, 'Assignment-success account number does not match stored DVA');
            return;
        }
        if (
            virtualAccount.status === 'DISABLED' ||
            virtualAccount.status === 'FAILED' ||
            virtualAccount.managedPaymentAccount.status === 'DISABLED' ||
            virtualAccount.managedPaymentAccount.status === 'FAILED'
        ) {
            await this.quarantine(eventId, 'Assignment-success event references an inactive managed account');
            return;
        }

        await this.prisma.$transaction(async (tx) => {
            if (virtualAccount.status !== 'ACTIVE') {
                await tx.dedicatedVirtualAccount.update({
                    where: { id: virtualAccount.id },
                    data: { status: 'ACTIVE', assignedAt: new Date() },
                });
                await this.audit.record(tx, {
                    organizationId: virtualAccount.managedPaymentAccount.organizationId,
                    action: 'managed_payment_account.virtual_account_activated',
                    entity: 'DedicatedVirtualAccount',
                    entityId: virtualAccount.id,
                    after: {
                        status: 'ACTIVE',
                        providerCustomerCode: virtualAccount.providerCustomerCode,
                    },
                });
            }
            await tx.webhookEvent.update({
                where: { id: eventId },
                data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
            });
        });
    }

    private async markDuplicatePaymentEventProcessed(
        eventId: string,
        payment: NormalizedPayment,
        context: PaymentContext,
    ): Promise<void> {
        const where = context.paymentAccountId
            ? {
                  paymentAccountId_providerReference: {
                      paymentAccountId: context.paymentAccountId,
                      providerReference: payment.providerReference,
                  },
              }
            : {
                  managedPaymentAccountId_providerReference: {
                      managedPaymentAccountId: context.managedPaymentAccountId!,
                      providerReference: payment.providerReference,
                  },
              };
        const existing = await this.prisma.payment.findUnique({ where });

        if (
            !existing ||
            existing.amountMinor !== payment.amountMinor ||
            existing.currency !== payment.currency ||
            existing.method !== payment.method ||
            existing.status !== 'SUCCEEDED' ||
            (context.dedicatedVirtualAccountId !== null &&
                existing.dedicatedVirtualAccountId !== context.dedicatedVirtualAccountId)
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
        if (error === null || typeof error !== 'object') return false;
        const prismaError = error as { code?: string; meta?: { target?: unknown } };
        if (prismaError.code !== 'P2002') return false;
        const target = prismaError.meta?.target;
        if (!Array.isArray(target)) return false;
        return (
            target.includes('providerReference') &&
            (target.includes('paymentAccountId') || target.includes('managedPaymentAccountId'))
        );
    }
}

function paymentCustomerCode(data: Record<string, unknown> | undefined): string | undefined {
    const customer = asRecord(data?.customer);
    return typeof customer?.customer_code === 'string' && customer.customer_code.trim() !== ''
        ? customer.customer_code
        : undefined;
}
