import { AuditService } from '../../audit/audit.service';
import { OutboxService } from '../../outbox/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookProcessorService } from './webhook-processor.service';

describe('WebhookProcessorService', () => {
    const webhookEvent = {
        id: 'webhook-1',
        eventType: 'charge.success',
        rawBody: JSON.stringify({
            event: 'charge.success',
            data: {
                id: 987,
                status: 'success',
                reference: 'paystack-ref-1',
                amount: 125000,
                currency: 'NGN',
                channel: 'card',
                paid_at: '2026-10-20T10:00:00.000Z',
            },
        }),
        signatureValid: true,
        receivedAt: new Date('2026-10-20T10:01:00.000Z'),
        paymentAccountId: 'payment-account-1',
        paymentAccount: {
            organizationId: 'org-1',
            branchId: 'branch-1',
        },
    };

    let paymentCreate: jest.Mock;
    let auditCreate: jest.Mock;
    let outboxCreate: jest.Mock;
    let webhookUpdate: jest.Mock;
    let transaction: jest.Mock;
    let paymentFindUnique: jest.Mock;
    let service: WebhookProcessorService;

    beforeEach(() => {
        paymentCreate = jest.fn().mockResolvedValue({ id: 'payment-1' });
        auditCreate = jest.fn().mockResolvedValue({});
        outboxCreate = jest.fn().mockResolvedValue({});
        webhookUpdate = jest.fn().mockResolvedValue({});
        paymentFindUnique = jest.fn();
        transaction = jest.fn((callback) => callback({
            payment: { create: paymentCreate },
            auditLog: { create: auditCreate },
            outboxEvent: { create: outboxCreate },
            webhookEvent: { update: webhookUpdate },
        }));

        const prisma = {
            webhookEvent: {
                findUniqueOrThrow: jest.fn().mockResolvedValue(webhookEvent),
                update: webhookUpdate,
            },
            payment: { findUnique: paymentFindUnique },
            $transaction: transaction,
        } as unknown as PrismaService;
        service = new WebhookProcessorService(
            prisma,
            new AuditService(),
            new OutboxService(),
        );
    });

    it('atomically creates one successful payment, audit entry, and confirmed event', async () => {
        await service.process(webhookEvent.id);

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(paymentCreate).toHaveBeenCalledWith({
            data: {
                paymentAccountId: 'payment-account-1',
                organizationId: 'org-1',
                branchId: 'branch-1',
                providerReference: 'paystack-ref-1',
                providerPaymentId: '987',
                amountMinor: 125000n,
                currency: 'NGN',
                method: 'card',
                status: 'SUCCEEDED',
                occurredAt: new Date('2026-10-20T10:00:00.000Z'),
            },
        });
        expect(auditCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                organizationId: 'org-1',
                action: 'payment.confirmed',
                entity: 'Payment',
                entityId: 'payment-1',
            }),
        });
        expect(outboxCreate).toHaveBeenCalledWith({
            data: {
                type: 'payment.confirmed',
                organizationId: 'org-1',
                payload: {
                    paymentId: 'payment-1',
                    organizationId: 'org-1',
                    branchId: 'branch-1',
                    reference: 'paystack-ref-1',
                    amountMinor: '125000',
                    currency: 'NGN',
                },
            },
        });
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({
                status: 'PROCESSED',
                lastError: null,
            }),
        });
    });

    it('quarantines unsupported events without creating payment side effects', async () => {
        const findEvent = jest.fn().mockResolvedValue({
            ...webhookEvent,
            eventType: 'charge.failed',
        });
        const prisma = {
            webhookEvent: { findUniqueOrThrow: findEvent, update: webhookUpdate },
            payment: { findUnique: paymentFindUnique },
            $transaction: transaction,
        } as unknown as PrismaService;
        service = new WebhookProcessorService(prisma, new AuditService(), new OutboxService());

        await service.process(webhookEvent.id);

        expect(transaction).not.toHaveBeenCalled();
        expect(paymentCreate).not.toHaveBeenCalled();
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({
                status: 'QUARANTINED',
                lastError: 'Unsupported Paystack event: charge.failed',
            }),
        });
    });

    it('treats a repeated provider reference as already processed without duplicate events', async () => {
        paymentCreate.mockRejectedValue({
            code: 'P2002',
            meta: { target: ['paymentAccountId', 'providerReference'] },
        });
        paymentFindUnique.mockResolvedValue({
            amountMinor: 125000n,
            currency: 'NGN',
            method: 'card',
            status: 'SUCCEEDED',
        });

        await service.process(webhookEvent.id);

        expect(paymentFindUnique).toHaveBeenCalledWith({
            where: {
                paymentAccountId_providerReference: {
                    paymentAccountId: 'payment-account-1',
                    providerReference: 'paystack-ref-1',
                },
            },
        });
        expect(auditCreate).not.toHaveBeenCalled();
        expect(outboxCreate).not.toHaveBeenCalled();
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({ status: 'PROCESSED' }),
        });
    });

    it('quarantines malformed charge data rather than retrying it as a transient failure', async () => {
        const findEvent = jest.fn().mockResolvedValue({
            ...webhookEvent,
            rawBody: JSON.stringify({
                event: 'charge.success',
                data: { status: 'success', reference: 'missing-amount' },
            }),
        });
        const prisma = {
            webhookEvent: { findUniqueOrThrow: findEvent, update: webhookUpdate },
            payment: { findUnique: paymentFindUnique },
            $transaction: transaction,
        } as unknown as PrismaService;
        service = new WebhookProcessorService(prisma, new AuditService(), new OutboxService());

        await service.process(webhookEvent.id);

        expect(transaction).not.toHaveBeenCalled();
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({ status: 'QUARANTINED' }),
        });
    });
});
