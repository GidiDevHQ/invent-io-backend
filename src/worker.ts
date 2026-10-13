import './config/env';
import { Logger } from '@nestjs/common';
import { Queue, Worker, type RedisOptions } from 'bullmq';
import { PrismaService } from './prisma/prisma.service';
import { OutboxPublisher } from './outbox/outbox.publisher';

export const DOMAIN_EVENTS_QUEUE = 'domain-events';
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
 *  - consumes domain events from the queue
 * Real consumers (notifications, low-stock, summaries) plug into the Worker
 * handler as those modules land.
 */
async function bootstrap() {
    const logger = new Logger('worker');
    const connection = redisConnection();

    const prisma = new PrismaService();
    await prisma.onModuleInit();

    const queue = new Queue(DOMAIN_EVENTS_QUEUE, { connection });
    const publisher = new OutboxPublisher(prisma as never, queue);

    const consumer = new Worker(
        DOMAIN_EVENTS_QUEUE,
        async (job) => {
            // Placeholder handler. Consumers must be idempotent (events are
            // delivered at least once). Replace with real per-type handlers.
            logger.log(`event ${job.name} (${(job.data as { id?: string })?.id})`);
        },
        { connection },
    );
    consumer.on('failed', (job, err) => logger.error(`job ${job?.id} failed: ${err.message}`));

    const timer = setInterval(() => {
        publisher.publishPending().catch((err) => logger.error(`publish failed: ${err.message}`));
    }, POLL_INTERVAL_MS);

    logger.log(`worker started; polling outbox every ${POLL_INTERVAL_MS}ms`);

    const shutdown = async () => {
        clearInterval(timer);
        await consumer.close();
        await queue.close();
        await prisma.onModuleDestroy();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

void bootstrap();
