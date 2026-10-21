export type ChannelName = 'whatsapp' | 'email' | 'simulated';

export interface OutboundMessage {
    /** Phone number (whatsapp) or email address (email). */
    to: string;
    /** Email subject; ignored by phone-based channels. */
    subject?: string;
    body: string;
}

export interface SendResult {
    providerMessageId?: string;
}

/**
 * A delivery channel (WhatsApp, email, …). Adapters isolate the third party so
 * a provider can be swapped or mocked without touching NotificationService.
 */
export interface MessageChannel {
    readonly name: ChannelName;
    send(message: OutboundMessage): Promise<SendResult>;
}
