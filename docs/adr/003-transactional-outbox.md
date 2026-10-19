# ADR 003: Transactional outbox for domain events

Status: Accepted

## Context

Some work must happen after a database transaction commits: send an FCM push,
check low stock, update a summary, send a WhatsApp message. If code enqueues a
job directly after `commit()` and the process crashes in between, the event is
lost — unacceptable for a payment product (spec §18.6).

We also must not enqueue inside the transaction (the job could run before the
commit is visible, or the transaction could roll back after enqueuing).

## Options

1. **Enqueue right after commit** — simplest, but loses events on a crash in the
   gap between commit and enqueue. Rejected.
2. **Distributed transaction (2PC)** across Postgres and Redis — heavy,
   poorly supported, overkill for this scale. Rejected.
3. **Transactional outbox** — write an `outbox_event` row in the _same_
   transaction as the data change; a worker later publishes it and marks it
   processed. At-least-once delivery, no distributed transaction. Chosen.

## Decision

Adopt the transactional outbox.

- `OutboxService.enqueue(tx, event)` writes an `outbox_event` row inside the
  caller's transaction. It does **not** touch Redis, so the API process needs
  no queue connection to boot.
- A worker process (`src/worker.ts`, `npm run start:worker`) polls unprocessed
  rows, publishes each to a BullMQ queue (`domain-events`) with
  `jobId = event.id` for idempotency, and marks `processedAt`.
- Polls run sequentially within each worker. Rows are atomically claimed with a
  five-minute lease, so multiple worker processes do not normally publish the
  same row concurrently; expired claims are eligible again after a crash.
- Publish failures increment `attempts`, save `lastError`, and use capped
  exponential backoff. Events that reach ten attempts remain visible in the
  outbox table and can be re-enabled with
  `npm run outbox:retry -- <event-id>` after the underlying issue is addressed.
- Consumers must be idempotent, since delivery is at-least-once (a crash between
  publish and mark re-delivers).

### Dependency

Adds **`bullmq`** (used directly, not via `@nestjs/bullmq`, to avoid peer-dep
conflicts with this repo's Nest version) and **`ioredis`** (BullMQ's Redis
client, which BullMQ v6 no longer bundles). Redis is the queue backend;
`REDIS_URL` is now a required env var.

## Consequences

- Easier: reliable, crash-safe event delivery; one deployable image with two
  entrypoints (API + worker); modules stay decoupled (emit events, don't call
  each other).
- Harder: consumers must be idempotent; there's a small publish latency (poll
  interval); operational surface grows (a worker process + Redis to run).
- Follow-ups: real consumers (notifications, low-stock, weekly summary), a
  dedicated dead-letter queue, and metrics on queue depth / unprocessed outbox
  age.
