import { Injectable } from '@nestjs/common';
import type { ChannelName, MessageChannel, OutboundMessage, SendResult } from './message-channel';

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
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                sender: { email: fromEmail, name: fromName },
                to: [{ email: message.to }],
                subject: message.subject ?? 'Invent-IO notification',
                textContent: message.body,
            }),
        });

        const data = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string };
        if (!res.ok) {
            throw new Error(data.message ?? `Email send failed (${res.status})`);
        }
        return { providerMessageId: data.messageId };
    }
}
