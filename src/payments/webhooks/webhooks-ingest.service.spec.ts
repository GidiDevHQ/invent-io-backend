import { createHash } from 'node:crypto';
import { createHmac } from 'node:crypto';
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
    const platformSecret = 'sk_test_platform_secret';

    beforeEach(() => {
        process.env.PAYSTACK_PLATFORM_TEST_SECRET_KEY = platformSecret;
        create = jest.fn();
        const prisma = {
            paymentAccount: { findUnique: jest.fn().mockResolvedValue(account) },
            webhookEvent: { create },
        } as unknown as PrismaService;
        service = new WebhookIngestService(prisma);
    });

    afterAll(() => {
        delete process.env.PAYSTACK_PLATFORM_TEST_SECRET_KEY;
    });

    function sign(body: Buffer): string {
        return createHmac('sha512', platformSecret).update(body).digest('hex');
    }

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
                meta: {
                    driverAdapterError: {
                        cause: {
                            constraint: {
                                index: 'WebhookEvent_paymentAccountId_dedupeKey_key',
                            },
                        },
                    },
                },
            });

        const params = { integrationToken, rawBody, signature: undefined };
        await expect(service.ingestPaystack(params)).resolves.toBe('REJECTED');
        await expect(service.ingestPaystack(params)).resolves.toBe('REJECTED');
        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[0][0].data.dedupeKey).toBe(
            createHash('sha256').update(rawBody).digest('hex'),
        );
    });

    it('persists a valid platform event without a DIRECT account and dedupes redelivery', async () => {
        create.mockResolvedValue({});
        const platformBody = Buffer.from(JSON.stringify({
            event: 'charge.success',
            data: {
                reference: 'managed-reference',
                customer: { customer_code: 'CUS_managed' },
            },
        }));

        await expect(service.ingestPlatformPaystack({
            rawBody: platformBody,
            signature: sign(platformBody),
            correlationId: 'platform-request-1',
        })).resolves.toBe('ACCEPTED');

        expect(create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                paymentAccountId: null,
                eventType: 'charge.success',
                signatureValid: true,
                status: 'RECEIVED',
                platformDedupeKey: createHash('sha256').update(platformBody).digest('hex'),
                correlationId: 'platform-request-1',
            }),
        });
    });

    it('stores platform events with invalid signatures as rejected', async () => {
        create.mockResolvedValue({});
        const platformBody = Buffer.from(JSON.stringify({ event: 'charge.success', data: {} }));

        await expect(service.ingestPlatformPaystack({
            rawBody: platformBody,
            signature: 'invalid',
        })).resolves.toBe('REJECTED');

        expect(create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                paymentAccountId: null,
                signatureValid: false,
                status: 'REJECTED',
            }),
        });
    });

    it('returns DUPLICATE for a replayed valid platform delivery', async () => {
        create.mockRejectedValue({
            code: 'P2002',
            meta: {
                driverAdapterError: {
                    cause: {
                        constraint: { index: 'WebhookEvent_platformDedupeKey_key' },
                    },
                },
            },
        });
        const platformBody = Buffer.from(JSON.stringify({ event: 'charge.success', data: {} }));

        await expect(service.ingestPlatformPaystack({
            rawBody: platformBody,
            signature: sign(platformBody),
        })).resolves.toBe('DUPLICATE');
    });

    it('refuses to accept a live platform secret for the test-only route', async () => {
        process.env.PAYSTACK_PLATFORM_TEST_SECRET_KEY = 'sk_live_not_allowed';

        await expect(service.ingestPlatformPaystack({
            rawBody,
            signature: undefined,
        })).rejects.toThrow('PAYSTACK_PLATFORM_TEST_SECRET_KEY must be configured with a test key');
    });
});
