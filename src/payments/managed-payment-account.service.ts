import {
    ConflictException,
    Inject,
    Injectable,
    ServiceUnavailableException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { decryptSecret, encryptSecret } from './credentials-crypto';
import {
    PAYSTACK_MANAGED_CLIENT_FACTORY,
    type PaystackManagedClientFactory,
} from './paystack-managed.client.factory';
import { CreateManagedPaymentAccountDto } from './dto/create-managed-payment-account.dto';

@Injectable()
export class ManagedPaymentAccountService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        @Inject(PAYSTACK_MANAGED_CLIENT_FACTORY)
        private readonly createClient: PaystackManagedClientFactory,
    ) {}

    async get(tenant: TenantContext) {
        const account = await this.prisma.managedPaymentAccount.findUnique({
            where: { organizationId: tenant.organizationId },
            include: { virtualAccounts: true },
        });
        if (!account) return null;
        return this.toResponse(account);
    }

    async provision(tenant: TenantContext, dto: CreateManagedPaymentAccountDto) {
        if (!dto.ownerConsent) {
            throw new ConflictException('Owner consent is required to submit settlement details');
        }

        let account = await this.prisma.managedPaymentAccount.findUnique({
            where: { organizationId: tenant.organizationId },
            include: { virtualAccounts: true },
        });

        const last4 = dto.settlementAccountNumber.slice(-4);
        if (!account) {
            account = await this.prisma.managedPaymentAccount.create({
                data: {
                    organizationId: tenant.organizationId,
                    provider: 'PAYSTACK',
                    status: 'PENDING',
                    settlementBankCode: dto.settlementBankCode,
                    settlementAccountLast4: last4,
                    settlementAccountCiphertext: encryptSecret(dto.settlementAccountNumber),
                },
                include: { virtualAccounts: true },
            });
        } else if (
            account.settlementBankCode !== dto.settlementBankCode ||
            account.settlementAccountLast4 !== last4
        ) {
            throw new ConflictException(
                'A managed account provisioning attempt already exists with different settlement details',
            );
        } else if (account.settlementAccountCiphertext) {
            if (decryptSecret(account.settlementAccountCiphertext) !== dto.settlementAccountNumber) {
                throw new ConflictException(
                    'A managed account provisioning attempt already exists with different settlement details',
                );
            }
        } else if (account.providerSubaccountCode) {
            throw new ConflictException(
                'Cannot safely resume provisioning because settlement details were not retained for verification',
            );
        }

        if (account.virtualAccounts.length) return this.toResponse(account);

        const client = this.createClient();
        let subaccountCode = account.providerSubaccountCode;
        if (!subaccountCode) {
            const subaccount = await client.createSubaccount({
                business_name: dto.businessName,
                settlement_bank: dto.settlementBankCode,
                account_number: dto.settlementAccountNumber,
                percentage_charge: 0,
                primary_contact_email: dto.ownerEmail,
                primary_contact_name: dto.ownerName,
                ...(dto.ownerPhone ? { primary_contact_phone: dto.ownerPhone } : {}),
            });
            subaccountCode = subaccount.subaccount_code;
            account = await this.prisma.managedPaymentAccount.update({
                where: { id: account.id },
                data: { providerSubaccountCode: subaccountCode },
                include: { virtualAccounts: true },
            });
        }

        let customerCode = account.providerCustomerCode;
        if (!customerCode) {
            const customer = await client.createCustomer({
                email: dto.ownerEmail,
                first_name: dto.customerFirstName,
                last_name: dto.customerLastName,
                ...(dto.ownerPhone ? { phone: dto.ownerPhone } : {}),
            });
            customerCode = customer.customer_code;
            account = await this.prisma.managedPaymentAccount.update({
                where: { id: account.id },
                data: { providerCustomerCode: customerCode },
                include: { virtualAccounts: true },
            });
        }

        if (account.virtualAccounts.length) return this.toResponse(account);

        let virtualAccount;
        try {
            virtualAccount = await client.createDedicatedAccount({
                customer: customerCode,
                subaccount: subaccountCode,
                ...(dto.preferredBank ? { preferred_bank: dto.preferredBank } : {}),
            });
        } catch (error) {
            throw new ServiceUnavailableException(
                `Paystack DVA provisioning failed: ${error instanceof Error ? error.message : 'unknown provider error'}`,
            );
        }

        if (virtualAccount.customer.customer_code !== customerCode) {
            throw new ServiceUnavailableException('Paystack returned a DVA for an unexpected customer');
        }

        const saved = await this.prisma.$transaction(async (tx) => {
            const created = await tx.dedicatedVirtualAccount.create({
                data: {
                    managedPaymentAccountId: account.id,
                    provider: 'PAYSTACK',
                    providerCustomerCode: customerCode,
                    accountName: virtualAccount.account_name,
                    accountNumber: virtualAccount.account_number,
                    bankName: virtualAccount.bank.name,
                    bankSlug: dto.preferredBank ?? null,
                    currency: 'NGN',
                    status: 'PENDING',
                },
            });
            await tx.managedPaymentAccount.update({
                where: { id: account.id },
                data: {
                    status: 'ACTIVE',
                },
            });
            await this.audit.record(tx, {
                organizationId: tenant.organizationId,
                actorId: tenant.userId,
                action: 'managed_payment_account.provisioned',
                entity: 'ManagedPaymentAccount',
                entityId: account.id,
                after: {
                    providerSubaccountCode: subaccountCode,
                    providerCustomerCode: customerCode,
                    dedicatedVirtualAccountId: created.id,
                    settlementBankCode: dto.settlementBankCode,
                    settlementAccountLast4: last4,
                    percentageCharge: 0,
                },
            });
            return created;
        });

        return {
            id: account.id,
            status: 'ACTIVE',
            providerSubaccountCode: subaccountCode,
            settlementBankCode: account.settlementBankCode,
            settlementAccountLast4: last4,
            virtualAccounts: [saved],
        };
    }

    private toResponse(account: {
        id: string;
        status: string;
        providerSubaccountCode: string | null;
        settlementBankCode: string | null;
        settlementBankName: string | null;
        settlementAccountName: string | null;
        settlementAccountLast4: string | null;
        virtualAccounts: Array<{
            id: string;
            providerCustomerCode: string;
            accountName: string;
            accountNumber: string;
            bankName: string;
            currency: string;
            status: string;
            assignedAt: Date | null;
        }>;
    }) {
        return {
            id: account.id,
            status: account.status,
            providerSubaccountCode: account.providerSubaccountCode,
            settlementBankCode: account.settlementBankCode,
            settlementBankName: account.settlementBankName,
            settlementAccountName: account.settlementAccountName,
            settlementAccountLast4: account.settlementAccountLast4,
            virtualAccounts: account.virtualAccounts.map((virtualAccount) => ({
                id: virtualAccount.id,
                providerCustomerCode: virtualAccount.providerCustomerCode,
                accountName: virtualAccount.accountName,
                accountNumber: virtualAccount.accountNumber,
                bankName: virtualAccount.bankName,
                currency: virtualAccount.currency,
                status: virtualAccount.status,
                assignedAt: virtualAccount.assignedAt,
            })),
        };
    }
}
