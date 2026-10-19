import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Polls unprocessed outbox rows and publishes each to the queue, then marks it
 * processed. Lives in the worker process. Idempotent: the queue job id is the
 * event id, so re-publishing the same event is a no-op on the queue side, and a
 * crash between enqueue and mark results in at-least-once (never lost) delivery.
 */

const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 10_000;
const MAX_DELAY_MS = 15 * 60_000;
const CLAIM_DURATION_MS = 5 * 60_000;

export interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

interface OutboxWhere {
  id?: string | { in: string[] };
  processedAt?: null;
  attempts?: { lt?: number; gte?: number };
  availableAt?: { lte: Date };
  lockToken?: string | null;
  OR?: [{ lockedUntil: null }, { lockedUntil: { lte: Date } }];
}

interface OutboxUpdate {
  processedAt?: Date;
  attempts?: { increment: number } | number;
  lastError?: string | null;
  availableAt?: Date;
  lockToken?: string | null;
  lockedUntil?: Date | null;
}

export interface OutboxPrisma {
  outboxEvent: {
    findMany(args: {
      where: OutboxWhere;
      orderBy: { createdAt: 'asc' };
      take?: number;
    }): Promise<OutboxRow[]>;
    update(args: {
      where: { id: string; lockToken?: string };
      data: OutboxUpdate;
    }): Promise<unknown>;
    updateMany(args: {
      where: OutboxWhere;
      data: OutboxUpdate;
    }): Promise<{ count: number }>;
  };
}

export interface EventQueue {
  add(name: string, data: unknown, opts: { jobId: string }): Promise<unknown>;
}

export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);
  constructor(
    private readonly prisma: OutboxPrisma,
    private readonly queue: EventQueue,
  ) {}

  /** Publish up to `batchSize` pending events. Returns how many were published. */
  async publishPending(batchSize = 100): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.outboxEvent.findMany({
      where: {
        processedAt: null,
        attempts: { lt: MAX_ATTEMPTS },
        availableAt: { lte: now },
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });
    if (candidates.length === 0) {
      return 0;
    }

    // Selection above is advisory; the conditional update is the atomic claim
    // that prevents two worker processes from publishing the same row.
    const lockToken = randomUUID();
    const claimed = await this.prisma.outboxEvent.updateMany({
      where: {
        id: { in: candidates.map(({ id }) => id) },
        processedAt: null,
        attempts: { lt: MAX_ATTEMPTS },
        availableAt: { lte: now },
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
      data: {
        lockToken,
        lockedUntil: new Date(now.getTime() + CLAIM_DURATION_MS),
      },
    });
    if (claimed.count === 0) {
      return 0;
    }

    // The lease lets another poll recover rows if this worker crashes mid-batch.
    const events = await this.prisma.outboxEvent.findMany({
      where: { lockToken },
      orderBy: { createdAt: 'asc' },
    });

    this.logger.log(`Claimed ${events.length} pending events`);
    let publishedCount = 0;
    for (const event of events) {
      try {
        // jobId = event id makes enqueue idempotent on the queue side.
        await this.queue.add(event.type, event, { jobId: event.id });
        await this.prisma.outboxEvent.update({
          where: { id: event.id, lockToken },
          data: { processedAt: new Date(), lockToken: null, lockedUntil: null },
        });
        publishedCount++;
      } catch (err) {
        await this.recordFailure(event, lockToken, err);
      }
    }

    return publishedCount;
  }

  /** Re-enable an event that reached the retry limit. */
  async retryFailedEvent(id: string): Promise<void> {
    await retryFailedOutboxEvent(this.prisma, id);
    this.logger.log(`Outbox event ${id} was made eligible for retry`);
  }

  private async recordFailure(
    event: OutboxRow,
    lockToken: string,
    err: unknown,
  ): Promise<void> {
    const attempts = event.attempts + 1;
    const delay = Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
    await this.prisma.outboxEvent.update({
      where: { id: event.id, lockToken },
      data: {
        attempts: { increment: 1 },
        lastError: errorMessage(err),
        availableAt: new Date(Date.now() + delay),
        lockToken: null,
        lockedUntil: null,
      },
    });
    if (attempts >= MAX_ATTEMPTS) {
      this.logger.error(
        `Outbox event ${event.id} (${event.type}) reached ${attempts} attempts and requires manual retry: ${errorMessage(err)}`,
      );
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function retryFailedOutboxEvent(
  prisma: OutboxPrisma,
  id: string,
): Promise<void> {
  const result = await prisma.outboxEvent.updateMany({
    where: {
      id,
      processedAt: null,
      attempts: { gte: MAX_ATTEMPTS },
      lockToken: null,
    },
    data: {
      attempts: 0,
      lastError: null,
      availableAt: new Date(),
    },
  });
  if (result.count !== 1) {
    throw new Error(`Outbox event ${id} is not an unclaimed terminal failure`);
  }
}
