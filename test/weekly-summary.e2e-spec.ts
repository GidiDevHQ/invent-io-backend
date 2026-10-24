import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { WeeklySummaryService } from './../src/reports/weekly-summary.service';

/**
 * Drives the weekly digest through the real service + DB: it sends to the org's
 * reports-viewing members (the owner), writes NotificationLog rows under a
 * per-day event id, and re-running the same day is a no-op (idempotent).
 */
describe('Weekly summary (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let weekly: WeeklySummaryService;
    let orgId: string;

    const stamp = Date.now();
    const owner = { businessName: 'Weekly Org', name: 'W', email: `weekly-${stamp}@test.com`, password: 'password123' };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        prisma = app.get(PrismaService);
        weekly = app.get(WeeklySummaryService);

        const reg = await request(app.getHttpServer()).post('/v1/auth/register').send(owner).expect(201);
        orgId = reg.body.organizationId;
    }, 60000);

    afterAll(async () => {
        await app.close();
    });

    it('builds a summary with string money fields', async () => {
        const data = await weekly.buildSummary(orgId);
        expect(typeof data.revenue).toBe('string');
        expect(typeof data.margin).toBe('string');
        expect(Array.isArray(data.topSellers)).toBe(true);
        expect(Array.isArray(data.lowStock)).toBe(true);
    });

    it('sends to the owner and logs under a per-day event id, idempotently', async () => {
        const now = new Date();
        const eventId = `weekly-summary:${orgId}:${now.toISOString().slice(0, 10)}`;

        const first = await weekly.runForOrg(orgId, now);
        expect(first).toBe(true);

        const logs = await prisma.notificationLog.findMany({ where: { eventId } });
        expect(logs.length).toBeGreaterThanOrEqual(1);
        expect(logs.every((l) => l.template === 'weekly.summary')).toBe(true);

        // Second run the same day finds the prior log and no-ops.
        const second = await weekly.runForOrg(orgId, now);
        expect(second).toBe(false);

        const after = await prisma.notificationLog.count({ where: { eventId } });
        expect(after).toBe(logs.length); // no new rows
    });
});
