import { Emitter } from '@socket.io/redis-emitter';
import Redis from 'ioredis';
import { orgRoom } from './realtime.service';

/**
 * Worker-side emitter. The worker holds no socket connections; it publishes to
 * Redis and the API's Socket.IO adapter delivers to the connected clients in the
 * org room. Keep in sync with RealtimeService's room naming and event name.
 */
export function createRealtimeEmitter() {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set');
    const redis = new Redis(url);
    const emitter = new Emitter(redis);

    return {
        emitToOrg(organizationId: string, type: string, payload: unknown): void {
            emitter.to(orgRoom(organizationId)).emit('event', { type, payload });
        },
        async close(): Promise<void> {
            await redis.quit();
        },
    };
}
