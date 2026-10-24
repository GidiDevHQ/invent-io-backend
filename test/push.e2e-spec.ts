import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Web Push subscription management: any authenticated member can enrol a browser,
 * re-enrolling the same endpoint upserts (no duplicate), and unregister removes it.
 */
describe('Web Push subscriptions (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let token: string;

    const stamp = Date.now();
    const owner = { businessName: 'Push Org', name: 'P', email: `push-${stamp}@test.com`, password: 'password123' };
    const endpoint = `https://push.example/${stamp}`;
    const body = { endpoint, keys: { p256dh: 'BPp256dh', auth: 'authsecret' } };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);

        const reg = await request(app.getHttpServer()).post('/v1/auth/register').send(owner).expect(201);
        token = reg.body.accessToken;
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('exposes the VAPID public key endpoint', async () => {
        const res = await request(app.getHttpServer())
            .get('/v1/push/vapid-public-key')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(res.body).toHaveProperty('publicKey'); // null when VAPID unset; shape is the contract
    });

    it('registers a subscription, upserts on repeat, then removes it', async () => {
        const first = await request(app.getHttpServer())
            .post('/v1/push/subscriptions')
            .set('Authorization', `Bearer ${token}`)
            .send(body)
            .expect(201);
        expect(first.body.endpoint).toBe(endpoint);

        // Re-registering the same endpoint must not create a duplicate row.
        await request(app.getHttpServer())
            .post('/v1/push/subscriptions')
            .set('Authorization', `Bearer ${token}`)
            .send({ ...body, keys: { p256dh: 'rotated', auth: 'rotated' } })
            .expect(201);
        expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);

        await request(app.getHttpServer())
            .delete('/v1/push/subscriptions')
            .set('Authorization', `Bearer ${token}`)
            .send({ endpoint })
            .expect(200);
        expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
    });

    it('rejects a malformed subscription (missing keys)', async () => {
        await request(app.getHttpServer())
            .post('/v1/push/subscriptions')
            .set('Authorization', `Bearer ${token}`)
            .send({ endpoint: 'https://push.example/bad' })
            .expect(400);
    });

    it('requires authentication', async () => {
        await request(app.getHttpServer()).get('/v1/push/vapid-public-key').expect(401);
    });
});
