import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Logged-in credential changes: both require the current password; changing the
 * password revokes old sessions and switches which password works; changing the
 * email moves the address, marks it unverified, and rejects duplicates.
 */
describe('Account credentials (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    const stamp = Date.now();
    const owner = { businessName: 'Cred Org', name: 'C', email: `cred-${stamp}@test.com`, password: 'password123' };
    let token: string;
    let refreshToken: string;
    let userId: string;

    const login = (password: string) =>
        request(app.getHttpServer()).post('/v1/auth/login').send({ email: owner.email, password });

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);

        const reg = await request(app.getHttpServer()).post('/v1/auth/register').send(owner).expect(201);
        token = reg.body.accessToken;
        refreshToken = reg.body.refreshToken;
        userId = reg.body.userId;
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('requires authentication', async () => {
        await request(app.getHttpServer())
            .post('/v1/auth/change-password')
            .send({ currentPassword: owner.password, newPassword: 'whatever123' })
            .expect(401);
    });

    it('rejects a wrong current password', async () => {
        await request(app.getHttpServer())
            .post('/v1/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: 'not-it', newPassword: 'whatever123' })
            .expect(401);
    });

    it('changes the password, swaps which one works, and revokes sessions', async () => {
        const newPassword = 'freshpass789';
        await request(app.getHttpServer())
            .post('/v1/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: owner.password, newPassword })
            .expect(200)
            .expect((r) => expect(r.body).toEqual({ changed: true }));

        await login(owner.password).expect(401); // old password dead
        const relog = await login(newPassword).expect(201); // new one works
        token = relog.body.accessToken;
        owner.password = newPassword;

        // Pre-change refresh token was revoked.
        await request(app.getHttpServer())
            .post('/v1/auth/refresh')
            .send({ refreshToken })
            .expect(401);
    });

    it('changes the email, marks it unverified, and rejects a duplicate', async () => {
        const newEmail = `cred-new-${stamp}@test.com`;
        await request(app.getHttpServer())
            .post('/v1/auth/change-email')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: owner.password, newEmail })
            .expect(200)
            .expect((r) => expect(r.body).toEqual({ changed: true, verificationSent: true }));

        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        expect(user.email).toBe(newEmail);
        expect(user.emailVerified).toBe(false);

        // A second account, then try to take its email -> conflict.
        const other = { businessName: 'Other', name: 'O', email: `other-${stamp}@test.com`, password: 'password123' };
        await request(app.getHttpServer()).post('/v1/auth/register').send(other).expect(201);
        await request(app.getHttpServer())
            .post('/v1/auth/change-email')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: owner.password, newEmail: other.email })
            .expect(409);
    });
});
