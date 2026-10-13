import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';

/**
 * API-side outbox. Only exposes OutboxService.enqueue (a DB write). The queue
 * publishing and consumers live in the worker process (src/worker.ts), so the
 * API never needs a Redis connection to boot.
 *
 * Global so any module can inject OutboxService without importing this module.
 */
@Global()
@Module({
    providers: [OutboxService],
    exports: [OutboxService],
})
export class OutboxModule {}
