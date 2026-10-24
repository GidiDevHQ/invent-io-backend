import { PayoutAccountService } from './payout-account.service';
import { decryptSecret } from '../payments/credentials-crypto';
import type { TenantContext } from '../tenancy/tenant.decorator';

const tenant: TenantContext = {
    userId: 'u1',
    organizationId: 'org-1',
    branchId: null,
    membershipId: 'm1',
    roleId: 'r1',
    permissions: ['*'],
};

const dto = {
    bankCode: '058',
    bankName: 'GTBank',
    accountName: 'Marcel Ndanwe',
    accountNumber: '0123456789',
};

function makeService() {
    const payoutAccount = {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(async ({ create, update }: { create?: Record<string, unknown>; update?: Record<string, unknown> }) => ({
            id: 'pa1',
            updatedAt: new Date(),
            ...(create ?? update),
        })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = { payoutAccount, auditLog: { create: jest.fn() } };
    const audit = { record: jest.fn() };
    const service = new PayoutAccountService(prisma as never, audit as never);
    return { service, payoutAccount, audit };
}

describe('PayoutAccountService', () => {
    const OLD = process.env.CREDENTIALS_ENCRYPTION_KEY;
    beforeAll(() => {
        // 32-byte key so the real AES-GCM crypto runs in the test.
        process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    });
    afterAll(() => {
        process.env.CREDENTIALS_ENCRYPTION_KEY = OLD;
    });

    it('encrypts the account number, keeps only last4, and returns a safe view', async () => {
        const { service, payoutAccount } = makeService();

        const view = await service.upsert(tenant, dto);

        const stored = payoutAccount.upsert.mock.calls[0][0].create;
        // Full number is never stored in the clear, and decrypts back correctly.
        expect(stored.accountNumberCiphertext).not.toContain('0123456789');
        expect(decryptSecret(stored.accountNumberCiphertext)).toBe('0123456789');
        expect(stored.accountNumberLast4).toBe('6789');

        // The view never exposes the full number.
        expect(view).toMatchObject({ bankName: 'GTBank', accountName: 'Marcel Ndanwe', accountNumberLast4: '6789', currency: 'NGN' });
        expect(JSON.stringify(view)).not.toContain('0123456789');
    });

    it('audits an update when one already exists (without the full number)', async () => {
        const { service, payoutAccount, audit } = makeService();
        payoutAccount.findUnique.mockResolvedValue({ id: 'pa1' });

        await service.upsert(tenant, dto);

        expect(audit.record).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: 'payout_account.updated' }),
        );
        const after = audit.record.mock.calls[0][1].after;
        expect(JSON.stringify(after)).not.toContain('0123456789');
    });

    it('returns null when no account is set', async () => {
        const { service } = makeService();
        await expect(service.get(tenant)).resolves.toBeNull();
    });
});
