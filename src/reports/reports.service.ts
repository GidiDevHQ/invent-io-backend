import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { buildPage, clampLimit, decodeCursor, type Page } from '../common/pagination';

/** Midnight (org timezone) → UTC instant. No DST handling beyond the offset at that moment. */
function startOfDayUtc(dayStr: string, tz: string): Date {
    const guess = new Date(`${dayStr}T00:00:00Z`);
    const tzWall = new Date(guess.toLocaleString('en-US', { timeZone: tz }));
    const utcWall = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offset = tzWall.getTime() - utcWall.getTime();
    return new Date(guess.getTime() - offset);
}

function orgDayRange(dateStr: string | undefined, tz: string) {
    const day =
        dateStr ??
        new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
    const start = startOfDayUtc(day, tz);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { date: day, start, end };
}

export interface SalesFilter {
    from?: string;
    to?: string;
    branchId?: string;
    limit?: number;
    cursor?: string;
}

@Injectable()
export class ReportsService {
    constructor(private readonly prisma: PrismaService) {}

    private async orgTimezone(organizationId: string): Promise<string> {
        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { timezone: true },
        });
        return org?.timezone || 'UTC';
    }

    /** Today's (org timezone) sales count, revenue, margin, and low-stock count. */
    async dashboardSummary(tenant: TenantContext, dateStr?: string) {
        const tz = await this.orgTimezone(tenant.organizationId);
        const { date, start, end } = orgDayRange(dateStr, tz);

        const sales = await this.prisma.sale.findMany({
            where: { organizationId: tenant.organizationId, createdAt: { gte: start, lt: end } },
            select: { total: true, margin: true },
        });
        let revenue = 0n;
        let margin = 0n;
        for (const s of sales) {
            revenue += s.total;
            margin += s.margin;
        }

        const lowStock = await this.lowStockRows(tenant.organizationId);
        return {
            date,
            timezone: tz,
            salesCount: sales.length,
            revenue: revenue.toString(),
            margin: margin.toString(),
            lowStockCount: lowStock.length,
        };
    }

    /** Items at or below their low-stock threshold, across the org's branches. */
    async lowStock(tenant: TenantContext) {
        const rows = await this.lowStockRows(tenant.organizationId);
        return rows.map((r) => ({
            branchId: r.branchId,
            productId: r.productId,
            productName: (r as { product?: { name?: string } }).product?.name,
            qty: r.qty,
            lowStockThreshold: r.lowStockThreshold,
            flags: r.flags,
        }));
    }

    private async lowStockRows(organizationId: string) {
        const rows = await this.prisma.branchStock.findMany({
            where: { branch: { organizationId } },
            include: { product: { select: { name: true } } },
        });
        return rows.filter((r) => r.lowStockThreshold > 0 && r.qty <= r.lowStockThreshold);
    }

    /** Filtered, cursor-paginated sales list. Money fields serialized as strings. */
    async salesReport(tenant: TenantContext, filter: SalesFilter): Promise<Page<unknown>> {
        const take = clampLimit(filter.limit);
        const cursorId = decodeCursor(filter.cursor);

        const createdAt =
            filter.from || filter.to
                ? {
                      ...(filter.from ? { gte: new Date(filter.from) } : {}),
                      ...(filter.to ? { lt: new Date(filter.to) } : {}),
                  }
                : undefined;

        const rows = await this.prisma.sale.findMany({
            where: {
                organizationId: tenant.organizationId,
                ...(filter.branchId ? { branchId: filter.branchId } : {}),
                ...(createdAt ? { createdAt } : {}),
            },
            orderBy: { id: 'asc' },
            take: take + 1,
            ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
            include: { items: true },
        });

        const page = buildPage(rows as { id: string }[], take);
        return {
            items: page.items.map((s) => this.toSaleResponse(s)),
            nextCursor: page.nextCursor,
        };
    }

    private toSaleResponse(sale: any) {
        return {
            ...sale,
            total: sale.total?.toString(),
            margin: sale.margin?.toString(),
            variance: sale.variance?.toString(),
        };
    }
}
