import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ChannelName, MessageChannel, OutboundMessage, SendResult } from './message-channel';

/**
 * No-op channel that just logs. The safe default and fallback; also lets the
 * notification pipeline be demoed without real provider credentials.
 */
@Injectable()
export class SimulatedChannel implements MessageChannel {
    readonly name: ChannelName = 'simulated';
    private readonly log = new Logger(SimulatedChannel.name);

    async send(message: OutboundMessage): Promise<SendResult> {
        this.log.log(`[simulated] to=${message.to} :: ${message.body}`);
        return { providerMessageId: `sim-${randomUUID()}` };
    }
}
