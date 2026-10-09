import { Injectable } from '@nestjs/common';

/**
 * Data for one append-only audit entry.
 */
export interface AuditEntry {
    organizationId: string;
    actorId?: string | null;
    action: string;
    entity: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
}

/**
 * Minimal shape of a Prisma client/transaction client that can write audit
 * rows. Callers pass their *transaction* client so the audit row commits in the
 * same transaction as the action it records — if the audit write fails, the
 * whole action fails.
 */
export interface AuditableTx {
    auditLog: {
        create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
}

@Injectable()
export class AuditService {
    /**
     * Record an audit entry inside the caller's transaction.
     * Always call this with the transaction client, never a standalone client,
     * for actions that must be audited atomically (price/cost changes, stock
     * adjustments, refunds/voids, role/membership and payment-account changes).
     */
    async record(tx: AuditableTx, entry: AuditEntry): Promise<void> {
        await tx.auditLog.create({
            data: {
                organizationId: entry.organizationId,
                actorId: entry.actorId ?? null,
                action: entry.action,
                entity: entry.entity,
                entityId: entry.entityId,
                before: (entry.before ?? null) as never,
                after: (entry.after ?? null) as never,
            },
        });
    }
}
