import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { parseCsv } from './csv';

/** Upper bound so a single request can't try to load an unbounded file. */
const MAX_ROWS = 5000;

const REQUIRED_COLUMNS = ['name', 'price', 'cost'] as const;
const KNOWN_COLUMNS = ['name', 'sku', 'barcode', 'unit', 'price', 'cost'] as const;

export interface ImportRowError {
    row: number; // 1-based data row number (the header is not counted)
    message: string;
}

export interface ImportResult {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    errors: ImportRowError[];
}

interface ParsedProduct {
    name: string;
    sku: string | null;
    barcode: string | null;
    unit: string | null;
    price: number;
    cost: number;
}

/**
 * Bulk product import from a CSV. A shop owner typically arrives with an
 * existing spreadsheet; this is the fastest path to a populated catalog.
 *
 * Partial success by design: every row is validated, valid rows are imported,
 * and bad rows are reported with their row number rather than failing the whole
 * file. Rows with a SKU upsert on (organizationId, sku) — re-importing an
 * updated sheet edits in place instead of duplicating.
 */
@Injectable()
export class CatalogImportService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async importCsv(tenant: TenantContext, csv: string): Promise<ImportResult> {
        const records = parseCsv(csv);
        if (records.length === 0) {
            throw new BadRequestException('CSV is empty');
        }

        const header = records[0].map((h) => h.trim().toLowerCase());
        for (const col of REQUIRED_COLUMNS) {
            if (!header.includes(col)) {
                throw new BadRequestException(`CSV is missing the required "${col}" column`);
            }
        }
        const dataRows = records.slice(1);
        if (dataRows.length > MAX_ROWS) {
            throw new BadRequestException(`Too many rows (${dataRows.length}); limit is ${MAX_ROWS}`);
        }

        const col = (row: string[], name: (typeof KNOWN_COLUMNS)[number]): string =>
            (row[header.indexOf(name)] ?? '').trim();

        const result: ImportResult = { total: dataRows.length, created: 0, updated: 0, skipped: 0, errors: [] };

        for (let i = 0; i < dataRows.length; i++) {
            const rowNo = i + 1;
            let parsed: ParsedProduct;
            try {
                parsed = this.parseRow(dataRows[i], col);
            } catch (e) {
                result.skipped++;
                result.errors.push({ row: rowNo, message: (e as Error).message });
                continue;
            }

            try {
                const outcome = await this.upsertProduct(tenant, parsed);
                if (outcome === 'created') result.created++;
                else result.updated++;
            } catch (e) {
                result.skipped++;
                result.errors.push({ row: rowNo, message: this.friendlyDbError(e) });
            }
        }

        return result;
    }

    private parseRow(
        row: string[],
        col: (row: string[], name: (typeof KNOWN_COLUMNS)[number]) => string,
    ): ParsedProduct {
        const name = col(row, 'name');
        if (!name) throw new Error('name is required');

        const price = this.parseMinor(col(row, 'price'), 'price');
        const cost = this.parseMinor(col(row, 'cost'), 'cost');

        return {
            name,
            sku: col(row, 'sku') || null,
            barcode: col(row, 'barcode') || null,
            unit: col(row, 'unit') || null,
            price,
            cost,
        };
    }

    /** Integer minor units only — reject floats, negatives, and non-numbers. */
    private parseMinor(raw: string, field: string): number {
        if (raw === '') throw new Error(`${field} is required`);
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
            throw new Error(`${field} must be a whole number of minor units (got "${raw}")`);
        }
        return n;
    }

    private async upsertProduct(tenant: TenantContext, p: ParsedProduct): Promise<'created' | 'updated'> {
        return this.prisma.$transaction(async (tx) => {
            // SKU is the natural key within an org; without one every row is a new product.
            const existing = p.sku
                ? await tx.product.findFirst({
                      where: { organizationId: tenant.organizationId, sku: p.sku },
                  })
                : null;

            if (existing) {
                const after = await tx.product.update({
                    where: { id: existing.id },
                    data: {
                        name: p.name,
                        barcode: p.barcode,
                        unit: p.unit,
                        price: p.price,
                        cost: p.cost,
                        version: { increment: 1 },
                    },
                });
                await this.audit.record(tx, {
                    organizationId: tenant.organizationId,
                    actorId: tenant.userId,
                    action: 'product.imported',
                    entity: 'Product',
                    entityId: existing.id,
                    before: existing,
                    after,
                });
                return 'updated';
            }

            const created = await tx.product.create({
                data: {
                    organizationId: tenant.organizationId,
                    name: p.name,
                    sku: p.sku,
                    barcode: p.barcode,
                    unit: p.unit,
                    price: p.price,
                    cost: p.cost,
                },
            });
            await this.audit.record(tx, {
                organizationId: tenant.organizationId,
                actorId: tenant.userId,
                action: 'product.imported',
                entity: 'Product',
                entityId: created.id,
                after: created,
            });
            return 'created';
        });
    }

    /** Turn Prisma's unique-constraint error into a message the importer can act on. */
    private friendlyDbError(e: unknown): string {
        const code = (e as { code?: string }).code;
        if (code === 'P2002') {
            const target = (e as { meta?: { target?: unknown } }).meta?.target;
            const fields = Array.isArray(target) ? target.join(', ') : String(target ?? '');
            return `duplicate value for ${fields || 'a unique field'} (sku/barcode must be unique)`;
        }
        return (e as Error).message ?? 'could not import row';
    }
}
