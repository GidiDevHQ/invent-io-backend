import { Injectable } from '@nestjs/common';
import { esc, p, shell } from '../email-layout';
import type { ChannelName, MessageChannel, OutboundMessage, SendResult } from './message-channel';

/** Branded wrapper for a plain-text body, used when a message has no HTML of its own. */
function htmlFromText(body: string): string {
    return shell(p(esc(body).replace(/\n/g, '<br>')));
}

/**
 * Brevo (formerly Sendinblue) transactional email API. Note Brevo authenticates
 * with an `api-key` header (not Bearer). Uses global fetch — no extra dependency.
 */
@Injectable()
export class EmailChannel implements MessageChannel {
    readonly name: ChannelName = 'email';

    private config() {
        const apiKey = process.env.EMAIL_API_KEY;
        const fromEmail = process.env.EMAIL_FROM ?? 'no-reply@invent-io.example';
        const fromName = process.env.EMAIL_FROM_NAME ?? 'Invent-IO';
        if (!apiKey) {
            throw new Error('Email is not configured (EMAIL_API_KEY)');
        }
        return { apiKey, fromEmail, fromName };
    }

    async send(message: OutboundMessage): Promise<SendResult> {
        const { apiKey, fromEmail, fromName } = this.config();
        // Per-email sender (noreply@/hello@/billing@…) when provided; else the default.
        const sender = {
            email: message.from?.email ?? fromEmail,
            name: message.from?.name ?? fromName,
        };
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                sender,
                to: [{ email: message.to }],
                subject: message.subject ?? 'Invent-IO notification',
                htmlContent: message.html ?? htmlFromText(message.body),
                textContent: message.body, // plain-text fallback
            }),
        });

        const data = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string };
        if (!res.ok) {
            throw new Error(data.message ?? `Email send failed (${res.status})`);
        }
        return { providerMessageId: data.messageId };
    }
}
