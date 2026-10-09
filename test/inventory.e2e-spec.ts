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
