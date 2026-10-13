import { Injectable } from '@nestjs/common';

export interface OutboxEventInput {
    type: string;
    payload: unknown;
}

/**
 * Minimal transaction-client shape needed to write an outbox row. Callers pass
 * their transaction so the event is persisted in the SAME transaction as the
 * data change it describes — the whole point of the outbox pattern.
 */
export interface OutboxTx {
    outboxEvent: {
        create(args: { data: { type: string; payload: unknown } }): Promise<unknown>;
    };
}

@Injectable()
export class OutboxService {
    /**
     * Record a domain event inside the caller's transaction. It is published to
     * the queue later by the worker's OutboxPublisher. This method does NOT
     * touch Redis, so the API process never needs a queue connection.
     */
    async enqueue(tx: OutboxTx, event: OutboxEventInput): Promise<void> {
        await tx.outboxEvent.create({
            data: { type: event.type, payload: event.payload as never },
        });
    }
}
