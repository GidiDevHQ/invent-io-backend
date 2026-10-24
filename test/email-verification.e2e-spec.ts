import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { createHash } from 'crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Email verification end to end: a fresh registration is unverified; following a
 * valid link flips the flag; the link is single-use; and resend is guarded by
 * auth and no-ops once verified.
 */
describe('Email verification (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let token: string;
    let userId: string;

    const stamp = Date.now();
    const owner = { businessName: 'Verify Org', name: 'V', email: `verify-${stamp}@test.com`, password: 'password123' };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);

        const reg = await request(app.getHttpServer()).post('/v1/auth/register').send(owner).expect(201);
        token = reg.body.accessToken;
        userId = reg.body.userId;
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('a new user starts unverified', async () => {
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        expect(user.emailVerified).toBe(false);
    });

    it('verifies via a valid token, then rejects reuse and bad tokens', async () => {
        const raw = `raw-${stamp}`;
        await prisma.emailVerificationToken.create({
            data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 60_000) },
        });

        const res = await request(app.getHttpServer())
            .post('/v1/auth/verify-email')
            .send({ token: raw })
            .expect(200);
        expect(res.body).toEqual({ verified: true });

        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        expect(user.emailVerified).toBe(true);

        // Single-use: the same token can't verify again.
        await request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token: raw }).expect(400);
        // Unknown token.
        await request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token: 'nope' }).expect(400);
    });

    it('resend requires auth and no-ops once verified', async () => {
        await request(app.getHttpServer()).post('/v1/auth/verify-email/resend').expect(401);

        const res = await request(app.getHttpServer())
            .post('/v1/auth/verify-email/resend')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(res.body).toEqual({ sent: false, reason: 'already verified' });
    });
});
