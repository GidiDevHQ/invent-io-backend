import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Exercises the stock ledger end to end: restock increases the cached quantity,
 * an over-decrement goes negative and is flagged (never blocked), and another
 * organization cannot touch this branch's stock.
 */
describe('Inventory stock ledger (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    const stamp = Date.now();
    const ownerA = { businessName: 'Inv Org A', name: 'A', email: `inv-a-${stamp}@test.com`, password: 'password123' };
    const ownerB = { businessName: 'Inv Org B', name: 'B', email: `inv-b-${stamp}@test.com`, password: 'password123' };

    let tokenA: string;
    let tokenB: string;
    let branchAId: string;
    let productAId: string;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);

        const regA = await request(app.getHttpServer()).post('/v1/auth/register').send(ownerA).expect(201);
        tokenA = regA.body.accessToken;
        const branchA = await prisma.branch.findFirst({ where: { organizationId: regA.body.organizationId } });
        branchAId = branchA!.id;

        const product = await request(app.getHttpServer())
            .post('/v1/products')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ name: 'Rice 5kg', price: 500000, cost: 400000 })
            .expect(201);
        productAId = product.body.id;

        const regB = await request(app.getHttpServer()).post('/v1/auth/register').send(ownerB).expect(201);
        tokenB = regB.body.accessToken;
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('restock increases the cached branch quantity', async () => {
        await request(app.getHttpServer())
            .post('/v1/stock/adjustments')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ branchId: branchAId, productId: productAId, type: 'RESTOCK', qtyDelta: 10, reason: 'delivery' })
            .expect(201);

        const res = await request(app.getHttpServer())
            .get(`/v1/branches/${branchAId}/stock`)
            .set('Authorization', `Bearer ${tokenA}`)
            .expect(200);
        const row = res.body.find((r: { productId: string }) => r.productId === productAId);
        expect(row.qty).toBe(10);
    });

    it('allows stock to go negative and flags it (never blocks a sale)', async () => {
        await request(app.getHttpServer())
            .post('/v1/stock/adjustments')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ branchId: branchAId, productId: productAId, type: 'ADJUSTMENT', qtyDelta: -15, reason: 'correction' })
            .expect(201);

        const res = await request(app.getHttpServer())
            .get(`/v1/branches/${branchAId}/stock`)
            .set('Authorization', `Bearer ${tokenA}`)
            .expect(200);
        const row = res.body.find((r: { productId: string }) => r.productId === productAId);
        expect(row.qty).toBe(-5);
        expect(row.flags).toContain('NEGATIVE_STOCK');
    });

    it('sets a low-stock threshold, fires a crossing, and lists the item as low', async () => {
        // Current qty is -5 from the previous test. Set threshold 3 and restock to 8 (above),
        // then sell 6 to land at 2 (<= 3) — the crossing should be reported.
        await request(app.getHttpServer())
            .patch(`/v1/branches/${branchAId}/stock/${productAId}`)
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ lowStockThreshold: 3 })
            .expect(200);

        await request(app.getHttpServer())
            .post('/v1/stock/adjustments')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ branchId: branchAId, productId: productAId, type: 'RESTOCK', qtyDelta: 13, reason: 'restock' })
            .expect(201); // qty: -5 -> 8 (above threshold)

        const crossed = await request(app.getHttpServer())
            .post('/v1/stock/adjustments')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ branchId: branchAId, productId: productAId, type: 'ADJUSTMENT', qtyDelta: -6, reason: 'sold' })
            .expect(201); // qty: 8 -> 2 (crosses to <= 3)
        expect(crossed.body).toHaveLength(1);
        expect(crossed.body[0]).toMatchObject({ productId: productAId, qty: 2, lowStockThreshold: 3 });

        const low = await request(app.getHttpServer())
            .get(`/v1/branches/${branchAId}/low-stock`)
            .set('Authorization', `Bearer ${tokenA}`)
            .expect(200);
        expect(low.body.map((r: { productId: string }) => r.productId)).toContain(productAId);
    });

    it('rejects an adjustment with a missing reason', async () => {
        await request(app.getHttpServer())
            .post('/v1/stock/adjustments')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ branchId: branchAId, productId: productAId, type: 'RESTOCK', qtyDelta: 5 })
            .expect(400);
    });

    it('another organization cannot read this branch\'s stock', async () => {
        await request(app.getHttpServer())
            .get(`/v1/branches/${branchAId}/stock`)
            .set('Authorization', `Bearer ${tokenB}`)
            .expect(404);
    });

    it('another organization cannot adjust this branch\'s stock', async () => {
        await request(app.getHttpServer())
            .post('/v1/stock/adjustments')
            .set('Authorization', `Bearer ${tokenB}`)
            .send({ branchId: branchAId, productId: productAId, type: 'RESTOCK', qtyDelta: 5, reason: 'x' })
            .expect(404);
    });
});
