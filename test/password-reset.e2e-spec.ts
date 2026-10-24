import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { createHash } from 'crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Password reset end to end: requesting is always 200 (no account enumeration),
 * a valid token sets a new password and lets the user log in with it, the old
 * password stops working, the token is single-use, and all sessions are revoked.
 */
describe('Password reset (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let userId: string;
    let oldRefresh: string;

    const stamp = Date.now();
    const owner = { businessName: 'Reset Org', name: 'R', email: `reset-${stamp}@test.com`, password: 'password123' };
    const newPassword = 'brandnewpass456';

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);

        const reg = await request(app.getHttpServer()).post('/v1/auth/register').send(owner).expect(201);
        userId = reg.body.userId;
        oldRefresh = reg.body.refreshToken;
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('forgot-password returns 200 for both known and unknown emails', async () => {
        await request(app.getHttpServer())
            .post('/v1/auth/forgot-password')
            .send({ email: owner.email })
            .expect(200)
            .expect((r) => expect(r.body).toEqual({ sent: true }));

        await request(app.getHttpServer())
            .post('/v1/auth/forgot-password')
            .send({ email: `nobody-${stamp}@test.com` })
            .expect(200)
            .expect((r) => expect(r.body).toEqual({ sent: true }));
    });

    it('resets the password, rotates credentials, and revokes sessions', async () => {
        const raw = `reset-raw-${stamp}`;
        await prisma.passwordResetToken.create({
            data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 60_000) },
        });

        await request(app.getHttpServer())
            .post('/v1/auth/reset-password')
            .send({ token: raw, password: newPassword })
            .expect(200)
            .expect((r) => expect(r.body).toEqual({ reset: true }));

        // Old password no longer works; new one does.
        await request(app.getHttpServer())
            .post('/v1/auth/login')
            .send({ email: owner.email, password: owner.password })
            .expect(401);
        await request(app.getHttpServer())
            .post('/v1/auth/login')
            .send({ email: owner.email, password: newPassword })
            .expect(201);

        // Pre-reset refresh token was revoked.
        await request(app.getHttpServer())
            .post('/v1/auth/refresh')
            .send({ refreshToken: oldRefresh })
            .expect(401);

        // Token is single-use.
        await request(app.getHttpServer())
            .post('/v1/auth/reset-password')
            .send({ token: raw, password: 'anotherpass789' })
            .expect(400);
    });

    it('rejects a short new password', async () => {
        await request(app.getHttpServer())
            .post('/v1/auth/reset-password')
            .send({ token: 'whatever', password: 'short' })
            .expect(400);
    });
});
