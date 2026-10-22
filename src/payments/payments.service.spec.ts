import { AuditService } from '../audit/audit.service';
import { encodeCursor } from '../common/pagination';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
    const tenant: TenantContext = {
        userId: 'user-1',
        organizationId: 'org-1',
        branchId: null,
        membershipId: 'membership-1',
        roleId: 'owner',
        permissions: ['*'],
    };

    let paymentFindMany: jest.Mock;
    let paymentFindFirst: jest.Mock;
    let branchFindFirst: jest.Mock;
    let paymentCreate: jest.Mock;
    let auditCreate: jest.Mock;
    let outboxCreate: jest.Mock;
    let transaction: jest.Mock;
    let service: PaymentsService;

    beforeEach(() => {
        paymentFindMany = jest.fn().mockResolvedValue([
            {
                id: 'payment-1',
                organizationId: 'org-1',
                branchId: 'branch-1',
                amountMinor: 125000n,
                status: 'SUCCEEDED',
                occurredAt: new Date('2026-10-22T10:00:00.000Z'),
            },
        ]);
        paymentFindFirst = jest.fn();
        branchFindFirst = jest.fn().mockResolvedValue({ id: 'branch-1' });
        paymentCreate = jest.fn().mockResolvedValue({
            id: 'payment-cash-1',
            organizationId: 'org-1',
            branchId: 'branch-1',
            providerReference: 'cash_generated',
            amountMinor: 2500n,
            currency: 'NGN',
            method: 'cash',
            status: 'SUCCEEDED',
            occurredAt: new Date('2026-10-22T10:00:00.000Z'),
        });
        auditCreate = jest.fn().mockResolvedValue({});
        outboxCreate = jest.fn().mockResolvedValue({});
        transaction = jest.fn((callback) => callback({
            organization: { findUniqueOrThrow: jest.fn().mockResolvedValue({ currency: 'NGN' }) },
            payment: { create: paymentCreate },
            auditLog: { create: auditCreate },
            outboxEvent: { create: outboxCreate },
        }));

        const prisma = {
            payment: { findMany: paymentFindMany, findFirst: paymentFindFirst },
            branch: { findFirst: branchFindFirst },
            $transaction: transaction,
        } as unknown as PrismaService;
        service = new PaymentsService(prisma, new AuditService(), new OutboxService());
    });

    it('returns only succeeded unallocated payments within the requested tenant and branch', async () => {
        const page = await service.listUnallocated(tenant, { branchId: 'branch-1', limit: 10 });

        expect(branchFindFirst).toHaveBeenCalledWith({
            where: { id: 'branch-1', organizationId: 'org-1' },
            select: { id: true },
        });
        expect(paymentFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                organizationId: 'org-1',
                status: 'SUCCEEDED',
                allocation: null,
                branchId: 'branch-1',
            },
            take: 11,
        }));
        expect(page).toEqual({
            items: [expect.objectContaining({ amountMinor: '125000' })],
            nextCursor: null,
        });
    });

    it('rejects status filters that would violate the itemization queue contract', async () => {
        await expect(service.listUnallocated(tenant, { status: 'PENDING' }))
            .rejects.toThrow('Only SUCCEEDED payments can be listed');
        expect(paymentFindMany).not.toHaveBeenCalled();
    });

    it('continues pagination when the previous payment is allocated between requests', async () => {
        const occurredAt = new Date('2026-10-22T10:00:00.000Z');
        paymentFindFirst.mockResolvedValue({
            id: 'payment-previous',
            branchId: 'branch-1',
            occurredAt,
        });

        await service.listUnallocated(tenant, {
            branchId: 'branch-1',
            cursor: encodeCursor('payment-previous'),
        });

        expect(paymentFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                allocation: null,
                OR: [
                    { occurredAt: { gt: occurredAt } },
                    { occurredAt, id: { gt: 'payment-previous' } },
                ],
            }),
        }));
    });

    it('prevents branch-scoped users from querying another branch', async () => {
        await expect(service.listUnallocated({ ...tenant, branchId: 'branch-1' }, { branchId: 'branch-2' }))
            .rejects.toThrow('Cannot access payments for another branch');
        expect(paymentFindMany).not.toHaveBeenCalled();
    });

    it('creates a succeeded cash payment and publishes the shared confirmation event atomically', async () => {
        const result = await service.createManual(tenant, {
            amountMinor: '2500',
            branchId: 'branch-1',
        });

        expect(paymentCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                organizationId: 'org-1',
                branchId: 'branch-1',
                providerReference: expect.stringMatching(/^cash_[0-9a-f-]+$/),
                amountMinor: 2500n,
                currency: 'NGN',
                method: 'cash',
                status: 'SUCCEEDED',
            }),
        });
        expect(auditCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                organizationId: 'org-1',
                action: 'payment.manual_created',
                entityId: 'payment-cash-1',
            }),
        });
        expect(outboxCreate).toHaveBeenCalledWith({
            data: {
                type: 'payment.confirmed',
                organizationId: 'org-1',
                payload: expect.objectContaining({
                    paymentId: 'payment-cash-1',
                    branchId: 'branch-1',
                    amountMinor: '2500',
                    currency: 'NGN',
                }),
            },
        });
        expect(result.amountMinor).toBe('2500');
        expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('requires an active branch for organization-wide manual cash payments', async () => {
        branchFindFirst.mockResolvedValue(null);

        await expect(service.createManual(tenant, { amountMinor: '2500', branchId: 'missing' }))
            .rejects.toThrow('Active branch not found');
        expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects amounts that exceed the database payment amount range', async () => {
        await expect(service.createManual(tenant, {
            amountMinor: '9223372036854775808',
            branchId: 'branch-1',
        })).rejects.toThrow('amountMinor exceeds the supported payment amount');
        expect(transaction).not.toHaveBeenCalled();
    });
});
