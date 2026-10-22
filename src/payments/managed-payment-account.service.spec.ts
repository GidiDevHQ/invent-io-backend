import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { encryptSecret } from './credentials-crypto';
import { CreateManagedPaymentAccountDto } from './dto/create-managed-payment-account.dto';
import { ManagedPaymentAccountService } from './managed-payment-account.service';

const tenant: TenantContext = {
    userId: 'owner-1',
    organizationId: 'org-1',
    branchId: null,
    membershipId: 'membership-1',
    roleId: 'owner-role',
    permissions: ['*'],
};

const dto: CreateManagedPaymentAccountDto = {
    businessName: 'Example Business',
    settlementBankCode: '058',
    settlementAccountNumber: '0123456789',
    ownerEmail: 'owner@example.test',
    ownerName: 'Example Owner',
    customerFirstName: 'Example',
    customerLastName: 'Owner',
    ownerConsent: true,
};

function makeDto(overrides: Partial<CreateManagedPaymentAccountDto> = {}) {
    return Object.assign(new CreateManagedPaymentAccountDto(), dto, overrides);
}

describe('ManagedPaymentAccountService', () => {
    const previousEncryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
    const encryptionKey = Buffer.alloc(32, 7).toString('base64');

    beforeAll(() => {
        process.env.CREDENTIALS_ENCRYPTION_KEY = encryptionKey;
    });

    afterAll(() => {
        if (previousEncryptionKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
        else process.env.CREDENTIALS_ENCRYPTION_KEY = previousEncryptionKey;
    });

    it('provisions the subaccount and DVA, persisting encrypted settlement details', async () => {
        const account = {
            id: 'managed-1',
            organizationId: 'org-1',
            status: 'PENDING',
            providerSubaccountCode: null,
            providerCustomerCode: null,
            settlementBankCode: '058',
            settlementAccountLast4: '6789',
            settlementAccountCiphertext: encryptSecret(dto.settlementAccountNumber),
            virtualAccounts: [],
        };
        const managedAccountCreate = jest.fn().mockResolvedValue(account);
        const accountUpdate = jest.fn()
            .mockResolvedValueOnce({ ...account, providerSubaccountCode: 'ACCT_test' })
            .mockResolvedValueOnce({
                ...account,
                providerSubaccountCode: 'ACCT_test',
                providerCustomerCode: 'CUS_test',
            });
        const virtualAccountCreate = jest.fn().mockResolvedValue({
            id: 'dva-1',
            providerCustomerCode: 'CUS_test',
            accountName: 'Example Business/Example Owner',
            accountNumber: '0120000000',
            bankName: 'Test Bank',
            currency: 'NGN',
            status: 'PENDING',
            assignedAt: null,
        });
        const managedAccountUpdate = jest.fn().mockResolvedValue({});
        const auditLogCreate = jest.fn().mockResolvedValue({});
        const prisma = {
            managedPaymentAccount: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: managedAccountCreate,
                update: accountUpdate,
            },
            $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
                callback({
                    dedicatedVirtualAccount: { create: virtualAccountCreate },
                    managedPaymentAccount: { update: managedAccountUpdate },
                    auditLog: { create: auditLogCreate },
                }),
            ),
        } as unknown as PrismaService;
        const client = {
            createSubaccount: jest.fn().mockResolvedValue({ subaccount_code: 'ACCT_test' }),
            createCustomer: jest.fn().mockResolvedValue({ customer_code: 'CUS_test' }),
            createDedicatedAccount: jest.fn().mockResolvedValue({
                account_name: 'Example Business/Example Owner',
                account_number: '0120000000',
                bank: { name: 'Test Bank' },
                customer: { customer_code: 'CUS_test' },
            }),
        };
        const service = new ManagedPaymentAccountService(
            prisma,
            new AuditService(),
            () => client as never,
        );

        const result = await service.provision(tenant, dto);

        expect(client.createSubaccount).toHaveBeenCalledWith(expect.objectContaining({
            settlement_bank: '058',
            account_number: '0123456789',
            percentage_charge: 0,
        }));
        expect(client.createDedicatedAccount).toHaveBeenCalledWith({
            customer: 'CUS_test',
            subaccount: 'ACCT_test',
        });
        expect(managedAccountCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                settlementAccountLast4: '6789',
                settlementAccountCiphertext: expect.not.stringContaining(dto.settlementAccountNumber),
            }),
        }));
        expect(virtualAccountCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                managedPaymentAccountId: 'managed-1',
                accountNumber: '0120000000',
                status: 'PENDING',
            }),
        }));
        expect(result).toMatchObject({
            id: 'managed-1',
            status: 'ACTIVE',
            settlementAccountLast4: '6789',
            virtualAccounts: [{ id: 'dva-1', accountNumber: '0120000000', status: 'PENDING' }],
        });
    });

    it('resumes with persisted provider ids and rejects changed settlement details', async () => {
        const account = {
            id: 'managed-1',
            organizationId: 'org-1',
            status: 'PENDING',
            providerSubaccountCode: 'ACCT_existing',
            providerCustomerCode: 'CUS_existing',
            settlementBankCode: '058',
            settlementAccountLast4: '6789',
            settlementAccountCiphertext: encryptSecret(dto.settlementAccountNumber),
            virtualAccounts: [],
        };
        const virtualAccount = {
            id: 'dva-1',
            providerCustomerCode: 'CUS_existing',
            accountName: 'Example Business/Example Owner',
            accountNumber: '0120000000',
            bankName: 'Test Bank',
            currency: 'NGN',
            status: 'PENDING',
            assignedAt: null,
        };
        const prisma = {
            managedPaymentAccount: {
                findUnique: jest.fn().mockResolvedValue(account),
                update: jest.fn().mockResolvedValue({}),
            },
            $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
                callback({
                    dedicatedVirtualAccount: { create: jest.fn().mockResolvedValue(virtualAccount) },
                    managedPaymentAccount: { update: jest.fn().mockResolvedValue({}) },
                    auditLog: { create: jest.fn().mockResolvedValue({}) },
                }),
            ),
        } as unknown as PrismaService;
        const client = {
            createSubaccount: jest.fn(),
            createCustomer: jest.fn(),
            createDedicatedAccount: jest.fn().mockResolvedValue({
                account_name: virtualAccount.accountName,
                account_number: virtualAccount.accountNumber,
                bank: { name: virtualAccount.bankName },
                customer: { customer_code: 'CUS_existing' },
            }),
        };
        const service = new ManagedPaymentAccountService(
            prisma,
            new AuditService(),
            () => client as never,
        );

        await service.provision(tenant, dto);
        expect(client.createSubaccount).not.toHaveBeenCalled();
        expect(client.createCustomer).not.toHaveBeenCalled();

        await expect(service.provision(tenant, makeDto({
            settlementAccountNumber: '9999996789',
        }))).rejects.toThrow('different settlement details');
    });

    it('requires explicit owner consent before provisioning', async () => {
        const findUnique = jest.fn();
        const prisma = {
            managedPaymentAccount: { findUnique },
        } as unknown as PrismaService;
        const service = new ManagedPaymentAccountService(
            prisma,
            new AuditService(),
            jest.fn(),
        );

        await expect(service.provision(tenant, makeDto({ ownerConsent: false })))
            .rejects.toThrow('Owner consent is required');
        expect(findUnique).not.toHaveBeenCalled();
    });
});
