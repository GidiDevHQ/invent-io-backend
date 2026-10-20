import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookIngestService } from './webhooks-ingest.service';

jest.mock('../credentials-crypto', () => ({
    decryptSecret: () => 'test-secret',
}));

describe('WebhookIngestService', () => {
    const integrationToken = 'integration-token';
    const rawBody = Buffer.from(JSON.stringify({
        event: 'charge.success',
        data: { reference: 'payment-reference' },
    }));
    const account = {
        id: 'account-id',
        status: 'ACTIVE',
        secretCiphertext: 'encrypted-secret',
    };
    let create: jest.Mock;
    let service: WebhookIngestService;

    beforeEach(() => {
        create = jest.fn();
        const prisma = {
            paymentAccount: { findUnique: jest.fn().mockResolvedValue(account) },
            webhookEvent: { create },
        } as unknown as PrismaService;
        service = new WebhookIngestService(prisma);
    });

    it('stores invalid signatures as REJECTED', async () => {
        create.mockResolvedValue({});

        await expect(service.ingestPaystack({
            integrationToken,
            rawBody,
            signature: undefined,
        })).resolves.toBe('REJECTED');
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: 'REJECTED',
                signatureValid: false,
            }),
        }));
    });

    it('does not fail when the same invalid body is replayed', async () => {
        create
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce({
                code: 'P2002',
                meta: { target: ['paymentAccountId', 'dedupeKey'] },
            });

        const params = { integrationToken, rawBody, signature: undefined };
        await expect(service.ingestPaystack(params)).resolves.toBe('REJECTED');
        await expect(service.ingestPaystack(params)).resolves.toBe('REJECTED');
        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[0][0].data.dedupeKey).toBe(
            createHash('sha256').update(rawBody).digest('hex'),
        );
    });
});
