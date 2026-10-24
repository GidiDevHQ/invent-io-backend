import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Payout account end to end: owners set/replace/read/remove the org's payout
 * bank account; the full number is never returned (last4 only) and is stored
 * encrypted, not in the clear.
 */
describe('Payout account (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let token: string;
    let orgId: string;

    const stamp = Date.now();
    const owner = { businessName: 'Payout Org', name: 'P', email: `payout-${stamp}@test.com`, password: 'password123' };
    const body = { bankCode: '058', bankName: 'GTBank', accountName: 'Marcel Ndanwe', accountNumber: '0123456789' };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);

        const reg = await request(app.getHttpServer()).post('/v1/auth/register').send(owner).expect(201);
        token = reg.body.accessToken;
        orgId = reg.body.organizationId;
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    it('requires authentication', async () => {
        await request(app.getHttpServer()).get('/v1/payout-account').expect(401);
    });

    it('starts empty, then sets and reads back the account (last4 only)', async () => {
        await auth(request(app.getHttpServer()).get('/v1/payout-account'))
            .expect(200)
            .expect((r) => expect(r.body).toEqual({})); // null serializes to empty body

        const put = await auth(request(app.getHttpServer()).put('/v1/payout-account')).send(body).expect(200);
        expect(put.body).toMatchObject({ bankName: 'GTBank', accountName: 'Marcel Ndanwe', accountNumberLast4: '6789' });
        expect(JSON.stringify(put.body)).not.toContain('0123456789');

        const get = await auth(request(app.getHttpServer()).get('/v1/payout-account')).expect(200);
        expect(get.body.accountNumberLast4).toBe('6789');

        // Stored encrypted, not in the clear.
        const row = await prisma.payoutAccount.findUniqueOrThrow({ where: { organizationId: orgId } });
        expect(row.accountNumberCiphertext).not.toContain('0123456789');
        expect(row.accountNumberLast4).toBe('6789');
    });

    it('replaces on a second PUT (one row per org)', async () => {
        await auth(request(app.getHttpServer()).put('/v1/payout-account'))
            .send({ ...body, accountNumber: '9988776655', accountName: 'Marcel N.' })
            .expect(200)
            .expect((r) => expect(r.body.accountNumberLast4).toBe('6655'));
        expect(await prisma.payoutAccount.count({ where: { organizationId: orgId } })).toBe(1);
    });

    it('validates the account number format', async () => {
        await auth(request(app.getHttpServer()).put('/v1/payout-account'))
            .send({ ...body, accountNumber: 'not-digits' })
            .expect(400);
    });

    it('removes the account', async () => {
        await auth(request(app.getHttpServer()).delete('/v1/payout-account'))
            .expect(200)
            .expect((r) => expect(r.body).toEqual({ removed: true }));
        expect(await prisma.payoutAccount.count({ where: { organizationId: orgId } })).toBe(0);
    });
});
