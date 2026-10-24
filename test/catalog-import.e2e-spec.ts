import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Bulk CSV import: valid rows land, re-importing with a changed price upserts on
 * SKU instead of duplicating, and a bad row is skipped+reported while the good
 * rows still import.
 */
describe('Catalog CSV import (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let token: string;
    let orgId: string;

    const stamp = Date.now();
    const owner = { businessName: 'Import Org', name: 'I', email: `import-${stamp}@test.com`, password: 'password123' };
    const sku = (s: string) => `${s}-${stamp}`;

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

    const importCsv = (csv: string) =>
        request(app.getHttpServer())
            .post('/v1/products/import')
            .set('Authorization', `Bearer ${token}`)
            .send({ csv });

    it('imports valid rows, then upserts on re-import by SKU', async () => {
        const soap = sku('SOAP');
        const rice = sku('RICE');

        const first = await importCsv(
            `name,sku,price,cost\nBar Soap,${soap},150000,90000\nRice,${rice},500000,400000`,
        ).expect(201);
        expect(first.body).toMatchObject({ total: 2, created: 2, updated: 0, skipped: 0 });

        // Re-import the soap row with a new price -> update, not a new product.
        const second = await importCsv(`name,sku,price,cost\nBar Soap XL,${soap},175000,95000`).expect(201);
        expect(second.body).toMatchObject({ created: 0, updated: 1 });

        const rows = await prisma.product.findMany({ where: { organizationId: orgId, sku: soap } });
        expect(rows).toHaveLength(1);
        expect(rows[0].price).toBe(175000);
        expect(rows[0].name).toBe('Bar Soap XL');
    });

    it('skips a bad row and reports it, importing the good ones', async () => {
        const good = sku('GOOD');
        const res = await importCsv(
            `name,sku,price,cost\nGood One,${good},150000,90000\nBad Price,${sku('BAD')},12.5,90000\n,,,`,
        ).expect(201);

        expect(res.body.created).toBe(1);
        expect(res.body.skipped).toBe(2);
        expect(res.body.errors.length).toBe(2);
    });

    it('400s when a required column is missing', async () => {
        await importCsv('name,price\nSoap,150000').expect(400);
    });
});
