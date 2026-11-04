import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
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
import { PaystackRequestError, type PaystackManagedClient } from './paystack-managed.client';
import { CreateManagedPaymentAccountDto } from './dto/create-managed-payment-account.dto';

@Injectable()
export class ManagedPaymentAccountService {
    private readonly log = new Logger(ManagedPaymentAccountService.name);

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
        const settlement = {
            settlementBankCode: dto.settlementBankCode,
            settlementAccountLast4: last4,
            settlementAccountCiphertext: this.withKey(() => encryptSecret(dto.settlementAccountNumber)),
        };
        if (!account) {
            account = await this.prisma.managedPaymentAccount.create({
                data: {
                    organizationId: tenant.organizationId,
                    provider: 'PAYSTACK',
                    status: 'PENDING',
                    ...settlement,
                },
                include: { virtualAccounts: true },
            });
        } else if (!account.providerSubaccountCode) {
            // Paystack has not accepted any settlement details yet (e.g. the last
            // attempt was rejected for a mistyped account number), so a retry may
            // correct them instead of being locked out.
            account = await this.prisma.managedPaymentAccount.update({
                where: { id: account.id },
                data: settlement,
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
            const stored = account.settlementAccountCiphertext;
            if (this.withKey(() => decryptSecret(stored)) !== dto.settlementAccountNumber) {
                throw new ConflictException(
                    'A managed account provisioning attempt already exists with different settlement details',
                );
            }
        } else {
            throw new ConflictException(
                'Cannot safely resume provisioning because settlement details were not retained for verification',
            );
        }

        if (account.virtualAccounts.length) return this.toResponse(account);

        const client = this.client();
        let subaccountCode = account.providerSubaccountCode;
        if (!subaccountCode) {
            const subaccount = await this.paystack('settlement account', () => client.createSubaccount({
                business_name: dto.businessName,
                settlement_bank: dto.settlementBankCode,
                account_number: dto.settlementAccountNumber,
                percentage_charge: 0,
                primary_contact_email: dto.ownerEmail,
                primary_contact_name: dto.ownerName,
                ...(dto.ownerPhone ? { primary_contact_phone: dto.ownerPhone } : {}),
            }));
            subaccountCode = subaccount.subaccount_code;
            account = await this.prisma.managedPaymentAccount.update({
                where: { id: account.id },
                data: { providerSubaccountCode: subaccountCode },
                include: { virtualAccounts: true },
            });
        }

        let customerCode = account.providerCustomerCode;
        if (!customerCode) {
            const customer = await this.paystack('customer', () => client.createCustomer({
                email: dto.ownerEmail,
                first_name: dto.customerFirstName,
                last_name: dto.customerLastName,
                ...(dto.ownerPhone ? { phone: dto.ownerPhone } : {}),
            }));
            customerCode = customer.customer_code;
            account = await this.prisma.managedPaymentAccount.update({
                where: { id: account.id },
                data: { providerCustomerCode: customerCode },
                include: { virtualAccounts: true },
            });
        }

        if (account.virtualAccounts.length) return this.toResponse(account);

        const virtualAccount = await this.paystack('virtual account', () => client.createDedicatedAccount({
            customer: customerCode,
            subaccount: subaccountCode,
            ...(dto.preferredBank ? { preferred_bank: dto.preferredBank } : {}),
        }));

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

    /** Paystack client, or a clear 503 when the server is not configured for it. */
    private client(): PaystackManagedClient {
        try {
            return this.createClient();
        } catch (error) {
            this.log.error(`Managed payments misconfigured: ${(error as Error).message}`);
            throw new ServiceUnavailableException(
                'Managed payments are not configured on the server. Please contact support.',
            );
        }
    }

    /** Runs encryption/decryption, turning a missing or bad key into a clear 503. */
    private withKey<T>(fn: () => T): T {
        try {
            return fn();
        } catch (error) {
            this.log.error(`Settlement encryption failed: ${(error as Error).message}`);
            throw new ServiceUnavailableException(
                'Settlement details cannot be stored right now. Please contact support.',
            );
        }
    }

    /**
     * Calls Paystack. A rejection of what the owner entered (4xx, e.g. an invalid
     * account number) becomes a 400 carrying Paystack's reason so they can fix
     * it; anything else (outage, auth, bad response) becomes a 503.
     */
    private async paystack<T>(step: string, call: () => Promise<T>): Promise<T> {
        try {
            return await call();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown provider error';
            if (
                error instanceof PaystackRequestError &&
                error.status >= 400 &&
                error.status < 500 &&
                error.status !== 401 &&
                error.status !== 403
            ) {
                throw new BadRequestException(`Paystack rejected the ${step}: ${error.providerMessage}`);
            }
            this.log.error(`Paystack ${step} failed: ${message}`);
            throw new ServiceUnavailableException(`Paystack ${step} provisioning failed: ${message}`);
        }
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
