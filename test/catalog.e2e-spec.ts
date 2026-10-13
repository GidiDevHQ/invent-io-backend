import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

/**
 * Tenancy invariant: cross-tenant read and write attempts always fail.
 * Owner A creates a product; Owner B (a different organization) must not be
 * able to read, update, or delete it, and must not see it in their list.
 */
describe('Catalog tenant isolation (e2e)', () => {
    let app: INestApplication;

    // Unique emails per run so repeated runs don't collide on the user.email unique constraint.
    const stamp = Date.now();
    const ownerA = { businessName: 'Org A', name: 'Owner A', email: `a-${stamp}@test.com`, password: 'password123' };
    const ownerB = { businessName: 'Org B', name: 'Owner B', email: `b-${stamp}@test.com`, password: 'password123' };

    let tokenA: string;
    let tokenB: string;
    let productAId: string;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        // Mirror src/main.ts so routes and validation behave as in production.
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();

        const regA = await request(app.getHttpServer()).post('/v1/auth/register').send(ownerA).expect(201);
        tokenA = regA.body.accessToken;

        const created = await request(app.getHttpServer())
            .post('/v1/products')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ name: 'Bar Soap', price: 150000, cost: 90000 })
            .expect(201);
        productAId = created.body.id;

        const regB = await request(app.getHttpServer()).post('/v1/auth/register').send(ownerB).expect(201);
        tokenB = regB.body.accessToken;
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('owner A can read their own product', async () => {
        await request(app.getHttpServer())
            .get(`/v1/products/${productAId}`)
            .set('Authorization', `Bearer ${tokenA}`)
            .expect(200);
    });

    it('rejects unauthenticated access', async () => {
        await request(app.getHttpServer()).get('/v1/products').expect(401);
    });

    it('owner B cannot read owner A\'s product (404, not a leak)', async () => {
        await request(app.getHttpServer())
            .get(`/v1/products/${productAId}`)
            .set('Authorization', `Bearer ${tokenB}`)
            .expect(404);
    });

    it('owner B does not see owner A\'s product in their list', async () => {
        const res = await request(app.getHttpServer())
            .get('/v1/products')
            .set('Authorization', `Bearer ${tokenB}`)
            .expect(200);
        const ids = (res.body.items ?? []).map((p: { id: string }) => p.id);
        expect(ids).not.toContain(productAId);
    });

    it('owner B cannot update owner A\'s product', async () => {
        await request(app.getHttpServer())
            .patch(`/v1/products/${productAId}`)
            .set('Authorization', `Bearer ${tokenB}`)
            .send({ price: 1 })
            .expect(404);
    });

    it('owner B cannot deactivate owner A\'s product', async () => {
        await request(app.getHttpServer())
            .delete(`/v1/products/${productAId}`)
            .set('Authorization', `Bearer ${tokenB}`)
            .expect(404);
    });
});
