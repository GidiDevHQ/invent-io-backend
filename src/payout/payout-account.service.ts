import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { encryptSecret } from '../payments/credentials-crypto';
import { UpsertPayoutAccountDto } from './dto/payout-account.dto';

/** Public shape of a payout account — never exposes the full account number. */
export interface PayoutAccountView {
    bankCode: string;
    bankName: string;
    accountName: string;
    accountNumberLast4: string;
    currency: string;
    updatedAt: Date;
}

/**
 * Stores the organization's declared payout bank account (where settlements go).
 * One per org. The full account number is encrypted at rest (AES-256-GCM, the
 * same scheme as payment secrets); only the last four digits are returned, so
 * the number can never be read back out through the API. No money is moved here.
 */
@Injectable()
export class PayoutAccountService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    /** Create or replace the org's payout account. Owners only (see controller). */
    async upsert(tenant: TenantContext, dto: UpsertPayoutAccountDto): Promise<PayoutAccountView> {
        const accountNumberCiphertext = encryptSecret(dto.accountNumber);
        const accountNumberLast4 = dto.accountNumber.slice(-4);
        const currency = dto.currency?.toUpperCase() ?? 'NGN';

        const data = {
            bankCode: dto.bankCode,
            bankName: dto.bankName,
            accountName: dto.accountName,
            accountNumberCiphertext,
            accountNumberLast4,
            currency,
        };

        const existing = await this.prisma.payoutAccount.findUnique({
            where: { organizationId: tenant.organizationId },
            select: { id: true },
        });

        const row = await this.prisma.payoutAccount.upsert({
            where: { organizationId: tenant.organizationId },
            create: { organizationId: tenant.organizationId, createdBy: tenant.userId, ...data },
            update: data,
        });

        await this.audit.record(this.prisma, {
            organizationId: tenant.organizationId,
            actorId: tenant.userId,
            action: existing ? 'payout_account.updated' : 'payout_account.created',
            entity: 'PayoutAccount',
            entityId: row.id,
            // Never audit the full number — last4 + bank only.
            after: { bankName: row.bankName, accountName: row.accountName, last4: row.accountNumberLast4 },
        });

        return this.toView(row);
    }

    /** The org's payout account, or null if none is set. Never the full number. */
    async get(tenant: TenantContext): Promise<PayoutAccountView | null> {
        const row = await this.prisma.payoutAccount.findUnique({
            where: { organizationId: tenant.organizationId },
        });
        return row ? this.toView(row) : null;
    }

    async remove(tenant: TenantContext): Promise<{ removed: boolean }> {
        const res = await this.prisma.payoutAccount.deleteMany({
            where: { organizationId: tenant.organizationId },
        });
        if (res.count > 0) {
            await this.audit.record(this.prisma, {
                organizationId: tenant.organizationId,
                actorId: tenant.userId,
                action: 'payout_account.removed',
                entity: 'PayoutAccount',
                entityId: tenant.organizationId,
            });
        }
        return { removed: res.count > 0 };
    }

    private toView(row: {
        bankCode: string;
        bankName: string;
        accountName: string;
        accountNumberLast4: string;
        currency: string;
        updatedAt: Date;
    }): PayoutAccountView {
        return {
            bankCode: row.bankCode,
            bankName: row.bankName,
            accountName: row.accountName,
            accountNumberLast4: row.accountNumberLast4,
            currency: row.currency,
            updatedAt: row.updatedAt,
        };
    }
}
