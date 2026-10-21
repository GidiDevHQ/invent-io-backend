import { Injectable } from '@nestjs/common';
import type { ChannelName, MessageChannel, OutboundMessage, SendResult } from './message-channel';

/**
 * WhatsApp Cloud API (Meta). Sends a free-form text message, which is valid
 * inside the 24-hour customer-service window; business-initiated messages need
 * an approved template (future work). Uses global fetch — no extra dependency.
 */
@Injectable()
export class WhatsAppChannel implements MessageChannel {
    readonly name: ChannelName = 'whatsapp';

    private config() {
        const token = process.env.WHATSAPP_TOKEN;
        const phoneId = process.env.WHATSAPP_PHONE_ID;
        const version = process.env.WHATSAPP_API_VERSION ?? 'v26.0';
        if (!token || !phoneId) {
            throw new Error('WhatsApp is not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)');
        }
        return { token, phoneId, version };
    }

    async send(message: OutboundMessage): Promise<SendResult> {
        const { token, phoneId, version } = this.config();
        const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: message.to,
                type: 'text',
                text: { body: message.body },
            }),
        });

        const data = (await res.json().catch(() => ({}))) as {
            messages?: { id?: string }[];
            error?: { message?: string };
        };
        if (!res.ok) {
            throw new Error(data.error?.message ?? `WhatsApp send failed (${res.status})`);
        }
        return { providerMessageId: data.messages?.[0]?.id };
    }
}
