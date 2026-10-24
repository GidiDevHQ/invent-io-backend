import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ChannelName, MessageChannel } from './channels/message-channel';
import { SimulatedChannel } from './channels/simulated.channel';
import { WhatsAppChannel } from './channels/whatsapp.channel';
import { EmailChannel } from './channels/email.channel';
import { WebPushChannel } from './channels/webpush.channel';
import { renderTemplate, type TemplateData } from './templates';

export interface SendNotification {
    organizationId: string;
    userId?: string | null;
    channel: ChannelName;
    to: string;
    template: string;
    data?: TemplateData;
    eventId?: string | null;
}

export interface SendOutcome {
    id: string;
    status: 'SENT' | 'FAILED';
    providerMessageId?: string;
    error?: string;
}

@Injectable()
export class NotificationService {
    private readonly channels: Record<ChannelName, MessageChannel>;

    constructor(
        private readonly prisma: PrismaService,
        simulated: SimulatedChannel,
        whatsapp: WhatsAppChannel,
        email: EmailChannel,
        webpush: WebPushChannel,
    ) {
        this.channels = { simulated, whatsapp, email, webpush };
    }

    /**
     * Render a named template and deliver it over the chosen channel, logging
     * the attempt. A provider failure is recorded (status FAILED) and never
     * throws — notification delivery must not break the caller (e.g. a sale).
     * Unknown template/channel is a caller error and does throw.
     */
    async send(params: SendNotification): Promise<SendOutcome> {
        const channel = this.channels[params.channel];
        if (!channel) {
            throw new BadRequestException(`Unknown channel: ${params.channel}`);
        }

        let rendered;
        try {
            rendered = renderTemplate(params.template, params.data);
        } catch (e) {
            throw new BadRequestException((e as Error).message);
        }

        let status: 'SENT' | 'FAILED' = 'SENT';
        let providerMessageId: string | undefined;
        let error: string | undefined;
        try {
            const result = await channel.send({
                to: params.to,
                subject: rendered.subject,
                body: rendered.body,
            });
            providerMessageId = result.providerMessageId;
        } catch (e) {
            status = 'FAILED';
            error = (e as Error).message;
        }

        const log = await this.prisma.notificationLog.create({
            data: {
                organizationId: params.organizationId,
                userId: params.userId ?? null,
                eventId: params.eventId ?? null,
                channel: params.channel,
                template: params.template,
                recipient: params.to,
                status,
                providerMessageId: providerMessageId ?? null,
                error: error ?? null,
            },
        });

        return { id: log.id, status, providerMessageId, error };
    }
}
