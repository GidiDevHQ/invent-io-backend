import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Exercises the allocation core: a confirmed payment becomes a sale, stock is
 * decremented through the ledger, replays are idempotent, and two concurrent
 * confirms of the same payment produce exactly one sale (the double-tap guard).
 */
describe('Sales allocation (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let token: string;
    let branchId: string;
    let productId: string;
    let accountId: string;

    const stamp = Date.now();
    const owner = { businessName: 'Sales Org', name: 'S', email: `sales-${stamp}@test.com`, password: 'password123' };

    // Seed a SUCCEEDED payment directly (the webhook path needs Paystack).
    async function seedPayment(amountMinor: bigint): Promise<string> {
        const p = await prisma.payment.create({
            data: {
                paymentAccountId: accountId,
                organizationId: (await prisma.branch.findUniqueOrThrow({ where: { id: branchId } })).organizationId,
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

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);

        const reg = await request(app.getHttpServer()).post('/v1/auth/register').send(owner).expect(201);
        token = reg.body.accessToken;
        const orgId = reg.body.organizationId;
        branchId = (await prisma.branch.findFirstOrThrow({ where: { organizationId: orgId } })).id;

        const product = await request(app.getHttpServer())
            .post('/v1/products')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Crate of Drinks', price: 500000, cost: 400000 })
            .expect(201);
        productId = product.body.id;

        // Restock so the happy-path sale lands on positive stock.
        await request(app.getHttpServer())
            .post('/v1/stock/adjustments')
            .set('Authorization', `Bearer ${token}`)
            .send({ branchId, productId, type: 'RESTOCK', qtyDelta: 10, reason: 'seed' })
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

    it('allocates a payment to a sale and decrements stock', async () => {
        const paymentId = await seedPayment(1000000n); // 2 x 500000, exact
        const res = await request(app.getHttpServer())
            .post(`/v1/payments/${paymentId}/match`)
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ productId, qty: 2 }], idempotencyKey: `k-${paymentId}` })
            .expect(201);

        expect(res.body.id).toBeDefined();
        expect(res.body.items).toHaveLength(1);

        const stock = await request(app.getHttpServer())
            .get(`/v1/branches/${branchId}/stock`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        const row = stock.body.find((r: { productId: string }) => r.productId === productId);
        expect(row.qty).toBe(8); // 10 restocked - 2 sold
    });

    it('is idempotent: replaying the same key returns the same sale', async () => {
        const paymentId = await seedPayment(500000n);
        const key = `idem-${paymentId}`;
        const first = await request(app.getHttpServer())
            .post(`/v1/payments/${paymentId}/match`)
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ productId, qty: 1 }], idempotencyKey: key })
            .expect(201);
        const second = await request(app.getHttpServer())
            .post(`/v1/payments/${paymentId}/match`)
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ productId, qty: 1 }], idempotencyKey: key })
            .expect(201);
        expect(second.body.id).toBe(first.body.id);
    });

    it('concurrent double-match of one payment yields exactly one sale', async () => {
        const paymentId = await seedPayment(500000n);
        const fire = (key: string) =>
            request(app.getHttpServer())
                .post(`/v1/payments/${paymentId}/match`)
                .set('Authorization', `Bearer ${token}`)
                .send({ items: [{ productId, qty: 1 }], idempotencyKey: key });

        const [a, b] = await Promise.all([fire('dev-A'), fire('dev-B')]);
        const statuses = [a.status, b.status].sort();
        expect(statuses).toEqual([201, 409]); // one succeeds, one conflicts
    });

    it('records and flags a variance without blocking the sale', async () => {
        const paymentId = await seedPayment(900000n); // 2 x 500000 = 1,000,000 -> variance -100,000
        const res = await request(app.getHttpServer())
            .post(`/v1/payments/${paymentId}/match`)
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ productId, qty: 2 }], idempotencyKey: `var-${paymentId}` })
            .expect(201);
        expect(res.body.flagged).toBe(true);
        expect(res.body.variance).toBe('-100000'); // BigInt serialized as string
    });
});
