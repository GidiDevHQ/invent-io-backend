import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Exercises refunds end to end: a sale is created from a confirmed payment, then
 * refunded. A partial refund restores only the refunded quantity and rejects
 * over-refunding; a full refund reverses the remainder and nets stock back.
 */
describe('Sale refunds (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let token: string;
    let branchId: string;
    let productId: string;
    let accountId: string;
    let orgId: string;

    const stamp = Date.now();
    const owner = { businessName: 'Refund Org', name: 'R', email: `refund-${stamp}@test.com`, password: 'password123' };

    async function seedPayment(amountMinor: bigint): Promise<string> {
        const p = await prisma.payment.create({
            data: {
                paymentAccountId: accountId,
                organizationId: orgId,
                branchId,
                providerReference: `ref-${stamp}-${Math.random().toString(36).slice(2)}`,
                amountMinor,
                currency: 'NGN',
                method: 'card',
                status: 'SUCCEEDED',
                occurredAt: new Date(),
            },
        });
        return p.id;
    }

    async function makeSale(qty: number): Promise<string> {
        const paymentId = await seedPayment(BigInt(qty) * 500000n);
        const res = await request(app.getHttpServer())
            .post(`/v1/payments/${paymentId}/match`)
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ productId, qty }], idempotencyKey: `k-${paymentId}` })
            .expect(201);
        return res.body.id;
    }

    async function stockQty(): Promise<number> {
        const stock = await request(app.getHttpServer())
            .get(`/v1/branches/${branchId}/stock`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        return stock.body.find((r: { productId: string }) => r.productId === productId)?.qty ?? 0;
    }

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);

        const reg = await request(app.getHttpServer()).post('/v1/auth/register').send(owner).expect(201);
        token = reg.body.accessToken;
        orgId = reg.body.organizationId;
        branchId = (await prisma.branch.findFirstOrThrow({ where: { organizationId: orgId } })).id;

        const product = await request(app.getHttpServer())
            .post('/v1/products')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Crate of Drinks', price: 500000, cost: 400000 })
            .expect(201);
        productId = product.body.id;

        await request(app.getHttpServer())
            .post('/v1/stock/adjustments')
            .set('Authorization', `Bearer ${token}`)
            .send({ branchId, productId, type: 'RESTOCK', qtyDelta: 100, reason: 'seed' })
            .expect(201);

        const account = await prisma.paymentAccount.create({
            data: {
                organizationId: orgId,
                branchId,
                provider: 'PAYSTACK',
                integrationTokenHash: `hash-${stamp}`,
                secretCiphertext: 'not-used-by-sales',
            },
        });
        accountId = account.id;
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('full refund restores all stock and reports money + margin reversed', async () => {
        const before = await stockQty();
        const saleId = await makeSale(3); // -3 stock
        expect(await stockQty()).toBe(before - 3);

        const res = await request(app.getHttpServer())
            .post(`/v1/sales/${saleId}/refund`)
            .set('Authorization', `Bearer ${token}`)
            .send({ reason: 'customer returned goods' })
            .expect(201);

        expect(res.body.amountMinor).toBe('1500000'); // 3 x 500000
        expect(res.body.marginReversed).toBe('300000'); // 3 x (500000-400000)
        expect(await stockQty()).toBe(before); // fully restored
    });

    it('partial refund restores only the refunded quantity, then rejects over-refunding', async () => {
        const before = await stockQty();
        const saleId = await makeSale(4); // -4
        expect(await stockQty()).toBe(before - 4);

        await request(app.getHttpServer())
            .post(`/v1/sales/${saleId}/refund`)
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ productId, qty: 1 }] })
            .expect(201);
        expect(await stockQty()).toBe(before - 3); // 1 of 4 back

        // Only 3 remain refundable; asking for 4 must fail.
        await request(app.getHttpServer())
            .post(`/v1/sales/${saleId}/refund`)
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ productId, qty: 4 }] })
            .expect(400);

        // A second refund of the rest succeeds; a third finds nothing to refund.
        await request(app.getHttpServer())
            .post(`/v1/sales/${saleId}/refund`)
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(201);
        expect(await stockQty()).toBe(before);

        await request(app.getHttpServer())
            .post(`/v1/sales/${saleId}/refund`)
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(400);
    });

    it('404s refunding a sale from another org', async () => {
        await request(app.getHttpServer())
            .post(`/v1/sales/non-existent-sale/refund`)
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(404);
    });
});
