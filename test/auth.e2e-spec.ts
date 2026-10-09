import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Auth hardening (e2e)', () => {
    let app: INestApplication;

    const stamp = Date.now();
    const user = {
        businessName: 'Auth Org',
        name: 'Auth Owner',
        email: `auth-${stamp}@test.com`,
        password: 'password123',
    };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();

        await request(app.getHttpServer()).post('/v1/auth/register').send(user).expect(201);
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('rejects login with a wrong password (#1)', async () => {
        await request(app.getHttpServer())
            .post('/v1/auth/login')
            .send({ email: user.email, password: 'wrong-password' })
            .expect(401);
    });

    it('accepts login with the correct password', async () => {
        const res = await request(app.getHttpServer())
            .post('/v1/auth/login')
            .send({ email: user.email, password: user.password })
            .expect(201);
        expect(res.body.accessToken).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();
    });

    it('rotates refresh tokens and detects reuse (#2)', async () => {
        const login = await request(app.getHttpServer())
            .post('/v1/auth/login')
            .send({ email: user.email, password: user.password })
            .expect(201);
        const firstRefresh = login.body.refreshToken;

        // First rotation succeeds and returns a new refresh token.
        const rotated = await request(app.getHttpServer())
            .post('/v1/auth/refresh')
            .send({ refreshToken: firstRefresh })
            .expect(201);
        expect(rotated.body.refreshToken).toBeDefined();
        expect(rotated.body.refreshToken).not.toEqual(firstRefresh);

        // Reusing the already-rotated token is rejected (family revoked).
        await request(app.getHttpServer())
            .post('/v1/auth/refresh')
            .send({ refreshToken: firstRefresh })
            .expect(401);
    });
});
