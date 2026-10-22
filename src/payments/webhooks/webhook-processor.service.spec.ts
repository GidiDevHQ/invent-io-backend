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
            id: 'payment-account-1',
            organizationId: 'org-1',
            branchId: 'branch-1',
            status: 'ACTIVE',
        },
    };

    let paymentCreate: jest.Mock;
    let auditCreate: jest.Mock;
    let outboxCreate: jest.Mock;
    let webhookUpdate: jest.Mock;
    let virtualAccountUpdate: jest.Mock;
    let transaction: jest.Mock;
    let paymentFindUnique: jest.Mock;
    let virtualAccountFindUnique: jest.Mock;
    let findEvent: jest.Mock;
    let service: WebhookProcessorService;

    beforeEach(() => {
        paymentCreate = jest.fn().mockResolvedValue({ id: 'payment-1' });
        auditCreate = jest.fn().mockResolvedValue({});
        outboxCreate = jest.fn().mockResolvedValue({});
        webhookUpdate = jest.fn().mockResolvedValue({});
        virtualAccountUpdate = jest.fn().mockResolvedValue({});
        paymentFindUnique = jest.fn();
        virtualAccountFindUnique = jest.fn();
        findEvent = jest.fn().mockResolvedValue(webhookEvent);
        transaction = jest.fn((callback) => callback({
            payment: { create: paymentCreate },
            auditLog: { create: auditCreate },
            outboxEvent: { create: outboxCreate },
            webhookEvent: { update: webhookUpdate },
            dedicatedVirtualAccount: { update: virtualAccountUpdate },
        }));

        const prisma = {
            webhookEvent: {
                findUniqueOrThrow: findEvent,
                update: webhookUpdate,
            },
            payment: { findUnique: paymentFindUnique },
            dedicatedVirtualAccount: { findUnique: virtualAccountFindUnique },
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
                managedPaymentAccountId: null,
                dedicatedVirtualAccountId: null,
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
        findEvent.mockResolvedValue({
            ...webhookEvent,
            eventType: 'charge.failed',
        });
        const prisma = {
            webhookEvent: { findUniqueOrThrow: findEvent, update: webhookUpdate },
            payment: { findUnique: paymentFindUnique },
            dedicatedVirtualAccount: { findUnique: virtualAccountFindUnique },
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
        findEvent.mockResolvedValue({
            ...webhookEvent,
            rawBody: JSON.stringify({
                event: 'charge.success',
                data: { status: 'success', reference: 'missing-amount' },
            }),
        });
        const prisma = {
            webhookEvent: { findUniqueOrThrow: findEvent, update: webhookUpdate },
            payment: { findUnique: paymentFindUnique },
            dedicatedVirtualAccount: { findUnique: virtualAccountFindUnique },
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

    it('creates a payment for a pending managed DVA during assignment-webhook race', async () => {
        findEvent.mockResolvedValue({
            ...webhookEvent,
            paymentAccountId: null,
            paymentAccount: null,
            rawBody: JSON.stringify({
                event: 'charge.success',
                data: {
                    id: 998,
                    status: 'success',
                    reference: 'managed-ref-1',
                    amount: 50000,
                    currency: 'NGN',
                    channel: 'dedicated_nuban',
                    customer: { customer_code: 'CUS_managed_1' },
                    authorization: { receiver_bank_account_number: '0120000000' },
                },
            }),
        });
        virtualAccountFindUnique.mockImplementation(async () => ({
            id: 'dva-1',
            accountNumber: '0120000000',
            managedPaymentAccountId: 'managed-account-1',
            status: 'PENDING',
            managedPaymentAccount: {
                organizationId: 'org-managed',
                status: 'PENDING',
            },
        }));

        await service.process(webhookEvent.id);

        expect(virtualAccountFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { providerCustomerCode: 'CUS_managed_1' },
                include: { managedPaymentAccount: true },
            }),
        );
        expect(virtualAccountFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { accountNumber: '0120000000' },
                include: { managedPaymentAccount: true },
            }),
        );
        expect(paymentCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                paymentAccountId: null,
                managedPaymentAccountId: 'managed-account-1',
                dedicatedVirtualAccountId: 'dva-1',
                organizationId: 'org-managed',
                providerReference: 'managed-ref-1',
                amountMinor: 50000n,
                method: 'dedicated_nuban',
                status: 'SUCCEEDED',
            }),
        });
        expect(auditCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({ organizationId: 'org-managed' }),
        });
        expect(outboxCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                organizationId: 'org-managed',
                payload: expect.objectContaining({ dedicatedVirtualAccountId: 'dva-1' }),
            }),
        });
    });

    it('does not attribute a DVA transfer to the DIRECT account that received its webhook', async () => {
        findEvent.mockResolvedValue({
            ...webhookEvent,
            rawBody: JSON.stringify({
                event: 'charge.success',
                data: {
                    status: 'success',
                    reference: 'dva-on-direct-route',
                    amount: 50000,
                    currency: 'NGN',
                    channel: 'dedicated_nuban',
                    customer: { customer_code: 'CUS_unknown' },
                },
            }),
        });
        virtualAccountFindUnique.mockResolvedValue(null);

        await service.process(webhookEvent.id);

        expect(transaction).not.toHaveBeenCalled();
        expect(paymentCreate).not.toHaveBeenCalled();
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({ status: 'QUARANTINED' }),
        });
    });

    it('quarantines managed events with an unknown customer code', async () => {
        findEvent.mockResolvedValue({
            ...webhookEvent,
            paymentAccountId: null,
            paymentAccount: null,
            rawBody: JSON.stringify({
                event: 'charge.success',
                data: {
                    status: 'success',
                    reference: 'unmapped-ref',
                    amount: 50000,
                    currency: 'NGN',
                    channel: 'dedicated_nuban',
                    customer: { customer_code: 'CUS_unknown' },
                },
            }),
        });
        virtualAccountFindUnique.mockResolvedValue(null);

        await service.process(webhookEvent.id);

        expect(transaction).not.toHaveBeenCalled();
        expect(paymentCreate).not.toHaveBeenCalled();
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({
                status: 'QUARANTINED',
                lastError: 'Verified webhook does not map to an active payment account or DVA',
            }),
        });
    });

    it('quarantines managed events for inactive virtual accounts', async () => {
        findEvent.mockResolvedValue({
            ...webhookEvent,
            paymentAccountId: null,
            paymentAccount: null,
            rawBody: JSON.stringify({
                event: 'charge.success',
                data: {
                    status: 'success',
                    reference: 'inactive-ref',
                    amount: 50000,
                    currency: 'NGN',
                    channel: 'dedicated_nuban',
                    customer: { customer_code: 'CUS_inactive' },
                },
            }),
        });
        virtualAccountFindUnique.mockResolvedValue({
            id: 'dva-disabled',
            managedPaymentAccountId: 'managed-account-1',
            status: 'DISABLED',
            managedPaymentAccount: { organizationId: 'org-managed', status: 'ACTIVE' },
        });

        await service.process(webhookEvent.id);

        expect(transaction).not.toHaveBeenCalled();
        expect(paymentCreate).not.toHaveBeenCalled();
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({ status: 'QUARANTINED' }),
        });
    });

    it('quarantines a DVA payment when customer code and receiver account resolve differently', async () => {
        findEvent.mockResolvedValue({
            ...webhookEvent,
            paymentAccountId: null,
            paymentAccount: null,
            rawBody: JSON.stringify({
                event: 'charge.success',
                data: {
                    status: 'success',
                    reference: 'conflicting-dva-ref',
                    amount: 50000,
                    currency: 'NGN',
                    channel: 'dedicated_nuban',
                    customer: { customer_code: 'CUS_managed_1' },
                    authorization: { receiver_bank_account_number: '0120000001' },
                },
            }),
        });
        virtualAccountFindUnique
            .mockResolvedValueOnce({
                id: 'dva-1',
                managedPaymentAccountId: 'managed-account-1',
                status: 'ACTIVE',
                managedPaymentAccount: { organizationId: 'org-1', status: 'ACTIVE' },
            })
            .mockResolvedValueOnce({
                id: 'dva-2',
                managedPaymentAccountId: 'managed-account-2',
                status: 'ACTIVE',
                managedPaymentAccount: { organizationId: 'org-2', status: 'ACTIVE' },
            });

        await service.process(webhookEvent.id);

        expect(transaction).not.toHaveBeenCalled();
        expect(paymentCreate).not.toHaveBeenCalled();
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({ status: 'QUARANTINED' }),
        });
    });

    it('activates a pending DVA from a verified platform assignment event', async () => {
        findEvent.mockResolvedValue({
            ...webhookEvent,
            eventType: 'dedicatedaccount.assign.success',
            paymentAccountId: null,
            paymentAccount: null,
            rawBody: JSON.stringify({
                event: 'dedicatedaccount.assign.success',
                data: {
                    customer: { customer_code: 'CUS_pending' },
                    dedicated_account: { account_number: '0120000000' },
                },
            }),
        });
        virtualAccountFindUnique.mockResolvedValue({
            id: 'dva-pending',
            accountNumber: '0120000000',
            providerCustomerCode: 'CUS_pending',
            managedPaymentAccountId: 'managed-account-1',
            status: 'PENDING',
            managedPaymentAccount: {
                organizationId: 'org-managed',
                status: 'PENDING',
            },
        });

        await service.process(webhookEvent.id);

        expect(virtualAccountUpdate).toHaveBeenCalledWith({
            where: { id: 'dva-pending' },
            data: { status: 'ACTIVE', assignedAt: expect.any(Date) },
        });
        expect(auditCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                organizationId: 'org-managed',
                action: 'managed_payment_account.virtual_account_activated',
                entity: 'DedicatedVirtualAccount',
                entityId: 'dva-pending',
            }),
        });
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({ status: 'PROCESSED', lastError: null }),
        });
        expect(paymentCreate).not.toHaveBeenCalled();
    });

    it('quarantines assignment events with a mismatched account number', async () => {
        findEvent.mockResolvedValue({
            ...webhookEvent,
            eventType: 'dedicatedaccount.assign.success',
            paymentAccountId: null,
            paymentAccount: null,
            rawBody: JSON.stringify({
                event: 'dedicatedaccount.assign.success',
                data: {
                    customer: { customer_code: 'CUS_pending' },
                    dedicated_account: { account_number: '9999999999' },
                },
            }),
        });
        virtualAccountFindUnique.mockResolvedValue({
            id: 'dva-pending',
            accountNumber: '0120000000',
            providerCustomerCode: 'CUS_pending',
            managedPaymentAccountId: 'managed-account-1',
            status: 'PENDING',
            managedPaymentAccount: { organizationId: 'org-managed', status: 'PENDING' },
        });

        await service.process(webhookEvent.id);

        expect(transaction).not.toHaveBeenCalled();
        expect(virtualAccountUpdate).not.toHaveBeenCalled();
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({
                status: 'QUARANTINED',
                lastError: 'Assignment-success account number does not match stored DVA',
            }),
        });
    });

    it('does not activate a DVA from a DIRECT account webhook', async () => {
        findEvent.mockResolvedValue({
            ...webhookEvent,
            eventType: 'dedicatedaccount.assign.success',
        });

        await service.process(webhookEvent.id);

        expect(virtualAccountFindUnique).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
        expect(webhookUpdate).toHaveBeenCalledWith({
            where: { id: webhookEvent.id },
            data: expect.objectContaining({ status: 'QUARANTINED' }),
        });
    });
});
