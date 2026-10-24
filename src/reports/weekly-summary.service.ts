import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { PushSubscriptionService } from '../notifications/push-subscription.service';
import { SUBSCRIPTION_GONE } from '../notifications/channels/webpush.channel';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TOP_SELLERS = 5;
// Only roles that can see reports get the business digest (P&L-type figures).
const REPORTS_PERMISSIONS = ['reports.view', '*'];

interface Recipient {
    userId: string;
    email?: string;
    phone?: string;
}

export interface WeeklySummaryData {
    revenue: string;
    margin: string;
    currency: string;
    topSellers: string[];
    lowStock: string[];
}

/**
 * Builds and dispatches the weekly business digest (revenue, margin, top
 * sellers, low stock) to each org's owners/managers. Invoked by a BullMQ
 * repeatable job in the worker — one scheduled fire does the work for every org,
 * so scaling the worker never duplicates the email (unlike an in-process cron).
 */
@Injectable()
export class WeeklySummaryService {
    private readonly log = new Logger(WeeklySummaryService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationService,
        private readonly pushSubscriptions: PushSubscriptionService,
    ) {}

    /** Entry point for the scheduler: run the digest for every organization. */
    async runForAllOrgs(now: Date = new Date()): Promise<{ orgs: number; sent: number; skipped: number }> {
        const orgs = await this.prisma.organization.findMany({ select: { id: true } });
        let sent = 0;
        let skipped = 0;
        for (const org of orgs) {
            const did = await this.runForOrg(org.id, now).catch((e) => {
                this.log.error(`weekly summary failed for org ${org.id}: ${(e as Error).message}`);
                return false;
            });
            if (did) sent++;
            else skipped++;
        }
        this.log.log(`weekly summary: ${orgs.length} orgs, ${sent} sent, ${skipped} skipped`);
        return { orgs: orgs.length, sent, skipped };
    }

    /** Build and send one org's digest. Returns false if there was nothing to send or it was already sent. */
    async runForOrg(organizationId: string, now: Date = new Date()): Promise<boolean> {
        // Idempotency: one digest per org per calendar day of the run. A re-fire
        // (restart, retry, extra worker) finds the prior log and no-ops.
        const eventId = `weekly-summary:${organizationId}:${now.toISOString().slice(0, 10)}`;
        const already = await this.prisma.notificationLog.findFirst({ where: { eventId } });
        if (already) {
            this.log.log(`weekly summary already sent for ${organizationId} (${eventId})`);
            return false;
        }

        const recipients = await this.recipientsFor(organizationId);
        if (recipients.length === 0) return false;

        const data = await this.buildSummary(organizationId, now);
        const templateData = { ...data } as Record<string, unknown>;

        for (const r of recipients) {
            if (r.email) {
                await this.notifications.send({
                    organizationId,
                    userId: r.userId,
                    channel: 'email',
                    to: r.email,
                    template: 'weekly.summary',
                    data: templateData,
                    eventId,
                });
            }
            if (r.phone) {
                await this.notifications.send({
                    organizationId,
                    userId: r.userId,
                    channel: 'whatsapp',
                    to: r.phone,
                    template: 'weekly.summary',
                    data: templateData,
                    eventId,
                });
            }
        }

        // Push to those same users' browsers; prune any gone subscriptions.
        const subs = await this.pushSubscriptions.forUsers(recipients.map((r) => r.userId));
        for (const s of subs) {
            const outcome = await this.notifications.send({
                organizationId,
                channel: 'webpush',
                to: JSON.stringify(s.subscription),
                template: 'weekly.summary',
                data: templateData,
                eventId,
            });
            if (outcome.status === 'FAILED' && outcome.error?.startsWith(SUBSCRIPTION_GONE)) {
                await this.pushSubscriptions.pruneByEndpoint(s.endpoint);
            }
        }
        return true;
    }

    /** Aggregate the trailing 7 days for an org: revenue, margin, top sellers, low stock. */
    async buildSummary(organizationId: string, now: Date = new Date()): Promise<WeeklySummaryData> {
        const start = new Date(now.getTime() - WEEK_MS);

        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { currency: true },
        });
        const currency = org?.currency ?? 'NGN';

        const sales = await this.prisma.sale.findMany({
            where: { organizationId, createdAt: { gte: start, lt: now } },
            select: { total: true, margin: true },
        });
        let revenue = 0n;
        let margin = 0n;
        for (const s of sales) {
            revenue += s.total;
            margin += s.margin;
        }

        // Top sellers by quantity over the window.
        const grouped = await this.prisma.saleItem.groupBy({
            by: ['productId'],
            where: { sale: { organizationId, createdAt: { gte: start, lt: now } } },
            _sum: { qty: true },
            orderBy: { _sum: { qty: 'desc' } },
            take: TOP_SELLERS,
        });
        const names = await this.productNames(grouped.map((g) => g.productId));
        const topSellers = grouped.map((g) => `${names.get(g.productId) ?? g.productId} (${g._sum.qty ?? 0})`);

        const lowStockRows = await this.prisma.branchStock.findMany({
            where: { branch: { organizationId } },
            include: { product: { select: { name: true } } },
        });
        const lowStock = lowStockRows
            .filter((r) => r.lowStockThreshold > 0 && r.qty <= r.lowStockThreshold)
            .map((r) => `${r.product?.name ?? r.productId} (${r.qty})`);

        return { revenue: revenue.toString(), margin: margin.toString(), currency, topSellers, lowStock };
    }

    private async productNames(ids: string[]): Promise<Map<string, string>> {
        if (ids.length === 0) return new Map();
        const rows = await this.prisma.product.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
        });
        return new Map(rows.map((r) => [r.id, r.name]));
    }

    /** Org members whose role can view reports (owners/managers), deduped by user. */
    private async recipientsFor(organizationId: string): Promise<Recipient[]> {
        const memberships = await this.prisma.membership.findMany({
            where: { organizationId, role: { permissions: { hasSome: REPORTS_PERMISSIONS } } },
            include: { user: true },
        });
        const byUser = new Map<string, Recipient>();
        for (const m of memberships) {
            byUser.set(m.userId, {
                userId: m.userId,
                email: m.user.email || undefined,
                phone: m.user.phone || undefined,
            });
        }
        return [...byUser.values()];
    }
}
