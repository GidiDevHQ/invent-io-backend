/**
 * Polls unprocessed outbox rows and publishes each to the queue, then marks it
 * processed. Lives in the worker process. Idempotent: the queue job id is the
 * event id, so re-publishing the same event is a no-op on the queue side, and a
 * crash between enqueue and mark results in at-least-once (never lost) delivery.
 */

export interface OutboxRow {
    id: string;
    type: string;
    payload: unknown;
}

export interface OutboxPrisma {
    outboxEvent: {
        findMany(args: {
            where: { processedAt: null };
            orderBy: { createdAt: 'asc' };
            take: number;
        }): Promise<OutboxRow[]>;
        update(args: { where: { id: string }; data: { processedAt: Date } }): Promise<unknown>;
    };
}

export interface EventQueue {
    add(name: string, data: unknown, opts: { jobId: string }): Promise<unknown>;
}

export class OutboxPublisher {
    constructor(
        private readonly prisma: OutboxPrisma,
        private readonly queue: EventQueue,
    ) {}

    /** Publish up to `batchSize` pending events. Returns how many were published. */
    async publishPending(batchSize = 100): Promise<number> {
        const events = await this.prisma.outboxEvent.findMany({
            where: { processedAt: null },
            orderBy: { createdAt: 'asc' },
            take: batchSize,
        });

        for (const event of events) {
            // jobId = event id makes enqueue idempotent on the queue side.
            await this.queue.add(event.type, event, { jobId: event.id });
            await this.prisma.outboxEvent.update({
                where: { id: event.id },
                data: { processedAt: new Date() },
            });
        }

        return events.length;
    }
}
