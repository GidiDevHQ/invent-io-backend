import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Reports (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let token: string;
    let branchId: string;
    let productId: string;

    const stamp = Date.now();
    const owner = { businessName: 'Reports Org', name: 'R', email: `rep-${stamp}@test.com`, password: 'password123' };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);

        const reg = await request(app.getHttpServer()).post('/v1/auth/register').send(owner).expect(201);
        token = reg.body.accessToken;
        branchId = (await prisma.branch.findFirstOrThrow({ where: { organizationId: reg.body.organizationId } })).id;

        const product = await request(app.getHttpServer())
            .post('/v1/products')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Report Item', price: 500000, cost: 300000 })
            .expect(201);
        productId = product.body.id;

        // Set a threshold while qty is 0 -> appears as low stock.
        await request(app.getHttpServer())
            .patch(`/v1/branches/${branchId}/stock/${productId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ lowStockThreshold: 5 })
            .expect(200);
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('requires auth', async () => {
        await request(app.getHttpServer()).get('/v1/dashboard/summary').expect(401);
    });

    it('returns a dashboard summary (no sales yet)', async () => {
        const res = await request(app.getHttpServer())
            .get('/v1/dashboard/summary')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(res.body.salesCount).toBe(0);
        expect(res.body.revenue).toBe('0'); // string, not number
        expect(res.body.lowStockCount).toBeGreaterThanOrEqual(1);
    });

    it('lists the low-stock item', async () => {
        const res = await request(app.getHttpServer())
            .get(`/v1/dashboard/low-stock`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(res.body.map((r: { productId: string }) => r.productId)).toContain(productId);
    });

    it('returns a (cursor-paginated) sales report', async () => {
        const res = await request(app.getHttpServer())
            .get('/v1/reports/sales?limit=10')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(res.body).toHaveProperty('items');
        expect(res.body).toHaveProperty('nextCursor');
    });
});
