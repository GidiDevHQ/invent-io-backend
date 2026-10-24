import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import type { ChannelName, MessageChannel, OutboundMessage, SendResult } from './message-channel';

/** Marker a gone subscription carries so the dispatcher can prune it. */
export const SUBSCRIPTION_GONE = 'SUBSCRIPTION_GONE';

/** Shape the browser's PushManager.subscribe() produces and the client sends us. */
export interface PushSubscriptionJSON {
    endpoint: string;
    keys: { p256dh: string; auth: string };
}

/**
 * Web Push (RFC 8030) delivery. Unlike email/WhatsApp, the "to" is a JSON
 * subscription object for one browser, and the OS shows the banner even when the
 * tab is closed — the piece ADR 009's WebSocket wake cannot cover. The payload
 * is a small JSON `{ title, body }` the service worker renders.
 *
 * VAPID keys authenticate us to the push service. They are optional config: a
 * send without them throws, exactly like the email channel without its API key.
 */
@Injectable()
export class WebPushChannel implements MessageChannel {
    readonly name: ChannelName = 'webpush';
    private readonly log = new Logger(WebPushChannel.name);
    private configured = false;

    /** Public VAPID key the client needs to create a subscription. */
    static publicKey(): string | undefined {
        return process.env.VAPID_PUBLIC_KEY || undefined;
    }

    private ensureConfigured(): void {
        if (this.configured) return;
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        const privateKey = process.env.VAPID_PRIVATE_KEY;
        const subject = process.env.VAPID_SUBJECT ?? 'mailto:no-reply@invent-io.example';
        if (!publicKey || !privateKey) {
            throw new Error('Web Push is not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
        }
        webpush.setVapidDetails(subject, publicKey, privateKey);
        this.configured = true;
    }

    async send(message: OutboundMessage): Promise<SendResult> {
        this.ensureConfigured();

        let subscription: PushSubscriptionJSON;
        try {
            subscription = JSON.parse(message.to) as PushSubscriptionJSON;
        } catch {
            throw new Error('Invalid push subscription (expected JSON)');
        }
        if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
            throw new Error('Invalid push subscription (missing endpoint or keys)');
        }

        const notification = JSON.stringify({
            title: message.subject ?? 'Invent-IO',
            body: message.body,
        });

        try {
            const res = await webpush.sendNotification(subscription, notification);
            return { providerMessageId: res.headers?.['location'] };
        } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            // 404/410 mean the subscription no longer exists; signal a prune.
            if (status === 404 || status === 410) {
                this.log.log(`subscription gone (${status}); flagging for prune`);
                throw new Error(`${SUBSCRIPTION_GONE}:${subscription.endpoint}`);
            }
            throw new Error((e as Error).message || `Web Push send failed (${status ?? 'unknown'})`);
        }
    }
}
