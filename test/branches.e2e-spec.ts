import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Branches (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let token: string;
    let orgId: string;
    let mainId: string;

    const stamp = Date.now();
    const owner = { businessName: 'Branch Org', name: 'B', email: `br-${stamp}@test.com`, password: 'password123' };

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
        mainId = (await prisma.branch.findFirstOrThrow({ where: { organizationId: orgId } })).id;
    });

    afterAll(async () => {
        await app.close();
    });

    it('GET /tenancy/me includes the branches an owner can use', async () => {
        const res = await request(app.getHttpServer())
            .get('/v1/tenancy/me')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(res.body.branchId).toBeNull(); // owners are org-wide by design
        expect(res.body.branches).toEqual([{ id: mainId, name: 'Main' }]);
    });

    it('GET /branches lists them', async () => {
        const res = await request(app.getHttpServer())
            .get('/v1/branches')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(res.body).toEqual([{ id: mainId, name: 'Main' }]);
    });

    it('a manual payment without branchId lands in the only branch', async () => {
        const res = await request(app.getHttpServer())
            .post('/v1/payments/manual')
            .set('Authorization', `Bearer ${token}`)
            .send({ amountMinor: '2500' })
            .expect(201);
        expect(res.body.branchId).toBe(mainId);
    });

    it('with a second branch, branchId becomes required', async () => {
        await prisma.branch.create({ data: { organizationId: orgId, name: 'Second' } });
        await request(app.getHttpServer())
            .post('/v1/payments/manual')
            .set('Authorization', `Bearer ${token}`)
            .send({ amountMinor: '2500' })
            .expect(400);
        await request(app.getHttpServer())
            .post('/v1/payments/manual')
            .set('Authorization', `Bearer ${token}`)
            .send({ amountMinor: '2500', branchId: mainId })
            .expect(201);
    });
});
