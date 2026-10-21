import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

export function orgRoom(organizationId: string): string {
    return `org:${organizationId}`;
}

export interface SocketIdentity {
    userId: string;
    organizationId?: string;
}

/**
 * API-side Socket.IO gateway. Authenticated, org-scoped rooms, backed by the
 * Redis adapter so the worker (and other API instances) can emit to a room.
 * Initialized from main.ts with the HTTP server.
 */
@Injectable()
export class RealtimeService {
    private io?: Server;
    private readonly log = new Logger(RealtimeService.name);

    constructor(private readonly jwt: JwtService) {}

    /** Verify a client's JWT and derive its identity. Throws on invalid token. */
    identify(token: string | undefined): SocketIdentity {
        if (!token) throw new Error('missing token');
        const payload = this.jwt.verify<{ sub: string; org?: string | null }>(token);
        return { userId: payload.sub, organizationId: payload.org ?? undefined };
    }

    init(httpServer: HttpServer): void {
        const url = process.env.REDIS_URL;
        if (!url) throw new Error('REDIS_URL is not set');

        this.io = new Server(httpServer, { cors: { origin: '*' } });

        const pub = new Redis(url);
        const sub = pub.duplicate();
        this.io.adapter(createAdapter(pub, sub));

        this.io.use((socket, next) => {
            try {
                const token =
                    (socket.handshake.auth?.token as string | undefined) ??
                    socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
                const identity = this.identify(token);
                (socket.data as SocketIdentity) = identity;
                next();
            } catch {
                next(new Error('unauthorized'));
            }
        });

        this.io.on('connection', (socket: Socket) => {
            const { userId, organizationId } = socket.data as SocketIdentity;
            if (organizationId) socket.join(orgRoom(organizationId));
            this.log.log(`socket connected user=${userId} org=${organizationId ?? '-'}`);
        });

        this.log.log('realtime gateway initialized');
    }
}
