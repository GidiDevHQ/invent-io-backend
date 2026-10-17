import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

const MAX_ATTEMPTS = 5;

@Injectable()
export class WebhookWorkerService implements OnModuleInit, OnModuleDestroy {
    private readonly log = new Logger(WebhookWorkerService.name);
    private timer?: ReturnType<typeof setInterval>;
    private running = false;

    constructor(private readonly prisma: PrismaService) {}

    onModuleInit() {
        if (process.env.WEBHOOK_WORKER_ENABLED !== 'true') return;
        this.timer = setInterval(() => void this.tick(), 5_000);
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
    }

    private async tick() {
        if (this.running) return;
        this.running = true;
        try {
            for (const { id } of await this.claim(10)) await this.handle(id);
        } catch (e) {
            this.log.error(e);
        } finally {
            this.running = false;
        }
    }


    private claim(limit: number) {
        return this.prisma.$queryRaw<{ id: string }[]>`
            UPDATE "WebhookEvent"
            SET status = 'PROCESSING',
                "claimedAt" = now(),
                attempts = attempts + 1
            WHERE id IN (
                SELECT id
                FROM "WebhookEvent"
                WHERE "signatureValid" = true
                    AND attempts < ${MAX_ATTEMPTS}
                    AND "availableAt" <= now()
                    AND (
                        status IN ('RECEIVED', 'FAILED')
                        -- Reclaim rows a crashed worker left in PROCESSING.
                        OR (status = 'PROCESSING' AND "claimedAt" < now() - interval '5 minutes')
                    )
                ORDER BY "receivedAt"
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id`;
    }

    private async handle(id: string) {
        try {
            // TODO: normalize payload -> ONE transaction that writes Payment + AuditLog +
            // outbox 'payment.confirmed' and marks this event PROCESSED.
            throw new Error('normalizer not implemented'); // deliberate: never mark PROCESSED without doing the work
        } catch (error: unknown) {
            const ev = await this.prisma.webhookEvent.findUniqueOrThrow({ where: { id } });
            const message = error instanceof Error ? error.message : String(error);
            await this.prisma.webhookEvent.update({
                where: { id },
                data: {
                    status: ev.attempts >= MAX_ATTEMPTS ? 'QUARANTINED' : 'FAILED',
                    lastError: message.slice(0, 500),
                    ...(ev.attempts < MAX_ATTEMPTS && {
                        // Exponential backoff: 2, 4, 8... minutes.
                        availableAt: new Date(Date.now() + 2 ** ev.attempts * 60_000),
                    }),
                },
            });
        }
    }
}