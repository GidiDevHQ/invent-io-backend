import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { createHash } from 'crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * OTP login end to end: requesting is always 200 (no enumeration), a correct
 * code returns a working session, a wrong code is rejected and burns an attempt,
 * and a consumed code can't be reused.
 */
describe('OTP login (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let userId: string;

    const stamp = Date.now();
    const owner = { businessName: 'OTP Org', name: 'O', email: `otp-${stamp}@test.com`, password: 'password123' };

    const seedCode = (code: string, over: Partial<{ expiresAt: Date; attempts: number }> = {}) =>
        prisma.otpCode.create({
            data: {
                userId,
                channel: 'email',
                codeHash: sha256(code),
                expiresAt: over.expiresAt ?? new Date(Date.now() + 5 * 60_000),
                attempts: over.attempts ?? 0,
            },
        });

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);

        const reg = await request(app.getHttpServer()).post('/v1/auth/register').send(owner).expect(201);
        userId = reg.body.userId;
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('request returns 200 for known and unknown identifiers', async () => {
        await request(app.getHttpServer())
            .post('/v1/auth/otp/request')
            .send({ identifier: owner.email })
            .expect(200)
            .expect((r) => expect(r.body).toEqual({ sent: true }));

        await request(app.getHttpServer())
            .post('/v1/auth/otp/request')
            .send({ identifier: `nobody-${stamp}@test.com` })
            .expect(200)
            .expect((r) => expect(r.body).toEqual({ sent: true }));
    });

    it('rejects a wrong code, then accepts the right one and returns a usable session', async () => {
        await prisma.otpCode.deleteMany({ where: { userId } }); // clear the throttle-era code
        await seedCode('654321');

        await request(app.getHttpServer())
            .post('/v1/auth/otp/verify')
            .send({ identifier: owner.email, code: '000000' })
            .expect(401);

        const ok = await request(app.getHttpServer())
            .post('/v1/auth/otp/verify')
            .send({ identifier: owner.email, code: '654321' })
            .expect(200);
        expect(ok.body.accessToken).toBeDefined();
        expect(ok.body.refreshToken).toBeDefined();

        // The issued access token works on a guarded route.
        await request(app.getHttpServer())
            .get('/v1/products')
            .set('Authorization', `Bearer ${ok.body.accessToken}`)
            .expect(200);

        // Code is single-use.
        await request(app.getHttpServer())
            .post('/v1/auth/otp/verify')
            .send({ identifier: owner.email, code: '654321' })
            .expect(401);
    });

    it('rejects an expired code', async () => {
        await prisma.otpCode.deleteMany({ where: { userId } });
        await seedCode('111111', { expiresAt: new Date(Date.now() - 1000) });
        await request(app.getHttpServer())
            .post('/v1/auth/otp/verify')
            .send({ identifier: owner.email, code: '111111' })
            .expect(401);
    });

    it('validates the code format (6 digits)', async () => {
        await request(app.getHttpServer())
            .post('/v1/auth/otp/verify')
            .send({ identifier: owner.email, code: '12' })
            .expect(400);
    });
});
