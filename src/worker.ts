import './config/env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker, type RedisOptions } from 'bullmq';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { OutboxPublisher } from './outbox/outbox.publisher';
import { NotificationDispatcher } from './notifications/notification-dispatcher';
import { WeeklySummaryService } from './reports/weekly-summary.service';
import { createRealtimeEmitter } from './realtime/realtime.emitter';

// Events that wake the open web dashboard in real time.
const REALTIME_EVENTS = new Set(['payment.confirmed', 'stock.low', 'sale.created']);

export const DOMAIN_EVENTS_QUEUE = 'domain-events';
export const SCHEDULED_JOBS_QUEUE = 'scheduled-jobs';
const WEEKLY_SUMMARY_JOB = 'weekly-summary';
// Monday 07:00 (business timezone) — a single scheduled fire does the work for
// every org, so adding worker instances never duplicates the digest.
const WEEKLY_SUMMARY_CRON = '0 7 * * 1';
const WEEKLY_SUMMARY_TZ = 'Africa/Lagos';
const POLL_INTERVAL_MS = 2000;

function redisConnection(): RedisOptions {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
  };
}

/**
 * Worker entrypoint. Same codebase as the API, different process:
 *  - runs the OutboxPublisher on an interval (DB -> queue)
 *  - consumes domain events from the queue and dispatches notifications
 * Runs inside a Nest application context (no HTTP server) so consumers resolve
 * via DI.
 */
async function bootstrap() {
  const logger = new Logger('worker');
  const connection = redisConnection();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const dispatcher = app.get(NotificationDispatcher);
  const weeklySummary = app.get(WeeklySummaryService);
  const realtime = createRealtimeEmitter();

  const queue = new Queue(DOMAIN_EVENTS_QUEUE, { connection });
  const publisher = new OutboxPublisher(prisma as never, queue);

  // Scheduled jobs: a BullMQ job scheduler enqueues the weekly summary on a cron.
  // upsertJobScheduler is keyed by id, so re-running on each deploy updates the
  // schedule in place rather than stacking duplicates.
  const scheduledQueue = new Queue(SCHEDULED_JOBS_QUEUE, { connection });
  await scheduledQueue.upsertJobScheduler(
    WEEKLY_SUMMARY_JOB,
    { pattern: WEEKLY_SUMMARY_CRON, tz: WEEKLY_SUMMARY_TZ },
    { name: WEEKLY_SUMMARY_JOB, data: {} },
  );

  const scheduledConsumer = new Worker(
    SCHEDULED_JOBS_QUEUE,
    async (job) => {
      if (job.name === WEEKLY_SUMMARY_JOB) {
        await weeklySummary.runForAllOrgs();
      }
    },
    { connection },
  );
  scheduledConsumer.on('failed', (job, err) =>
    logger.error(`scheduled job ${job?.name} failed: ${err.message}`),
  );

  const consumer = new Worker(
    DOMAIN_EVENTS_QUEUE,
    async (job) => {
      // job.data is the full outbox row { id, type, organizationId, payload, ... }.
      // Consumers must be idempotent (events are delivered at least once).
      const row = (job.data ?? {}) as {
        id?: string;
        organizationId?: string;
        payload?: Record<string, unknown>;
      };
      await dispatcher.handle({
        id: row.id,
        type: job.name,
        organizationId: row.organizationId,
        payload: row.payload ?? {},
      });

      // Wake the open web dashboard in real time (in addition to email/WhatsApp).
      if (row.organizationId && REALTIME_EVENTS.has(job.name)) {
        realtime.emitToOrg(row.organizationId, job.name, row.payload ?? {});
      }
    },
    { connection },
  );
  consumer.on('failed', (job, err) =>
    logger.error(`job ${job?.id} failed: ${err.message}`),
  );

  let stopping = false;
  let wakePoll: (() => void) | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const waitForNextPoll = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wakePoll = undefined;
        resolve();
      }, POLL_INTERVAL_MS);
      wakePoll = () => {
        clearTimeout(timer);
        wakePoll = undefined;
        resolve();
      };
    });

  const pollLoop = async () => {
    while (!stopping) {
      try {
        await publisher.publishPending();
      } catch (err) {
        logger.error(
          `publish failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!stopping) {
        // Wait after each completed poll so a slow batch cannot overlap itself.
        await waitForNextPoll();
      }
    }
  };
  const pollLoopPromise = pollLoop();

  logger.log(`worker started; polling outbox every ${POLL_INTERVAL_MS}ms`);

  const shutdown = () => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    stopping = true;
    wakePoll?.();
    shutdownPromise = (async () => {
      // Keep connections alive until the in-flight poll settles.
      await pollLoopPromise;
      await consumer.close();
      await scheduledConsumer.close();
      await queue.close();
      await scheduledQueue.close();
      await realtime.close();
      await app.close();
    })();
    return shutdownPromise;
  };
  const handleShutdown = () => {
    void shutdown().catch((err) =>
      logger.error(
        `worker shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  };
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

void bootstrap();
