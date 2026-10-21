import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { RealtimeService } from '../src/realtime/realtime.service';
import { createRealtimeEmitter } from '../src/realtime/realtime.emitter';

/**
 * End-to-end smoke test for the realtime gateway: boot the API, connect a
 * socket client with a JWT (org claim), emit a payment event via the worker-side
 * emitter, and confirm the client receives it in its org room.
 */
async function main() {
    const port = 3999;
    const orgId = `org-smoke-${Date.now()}`;

    const app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(port);
    app.get(RealtimeService).init(app.getHttpServer());

    const token = jwt.sign({ sub: 'u-smoke', org: orgId }, process.env.JWT_SECRET as string);
    const client = ioClient(`http://localhost:${port}`, { auth: { token } });

    const received = new Promise<unknown>((resolve, reject) => {
        client.on('event', resolve);
        client.on('connect_error', (e) => reject(e));
        setTimeout(() => reject(new Error('timeout waiting for event')), 8000);
    });

    await new Promise<void>((res) => client.on('connect', () => res()));
    await new Promise((r) => setTimeout(r, 500)); // let the room join propagate

    const emitter = createRealtimeEmitter();
    emitter.emitToOrg(orgId, 'payment.confirmed', { amountMinor: '350000', currency: 'NGN' });

    try {
        const evt = await received;
        console.log('RECEIVED', JSON.stringify(evt));
    } catch (e) {
        console.error('FAILED:', (e as Error).message);
    } finally {
        client.close();
        await emitter.close();
        await app.close();
        process.exit(0);
    }
}

void main();
