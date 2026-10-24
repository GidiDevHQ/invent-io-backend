import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { PushSubscriptionService } from './push-subscription.service';
import { SUBSCRIPTION_GONE } from './channels/webpush.channel';
import type { TemplateData } from './templates';

export interface DomainEvent {
    id?: string;
    type: string;
    organizationId?: string;
    payload: Record<string, unknown>;
}

interface Recipient {
    userId: string;
    email?: string;
    phone?: string;
}

/**
 * Turns outbox domain events into notifications. Runs in the worker process
 * (see src/worker.ts). Maps an event type to a template and resolves who in the
 * organization should be told. Opt-in/consent is not yet enforced (no consent
 * field on User yet) — for now the org's members are notified.
 */
@Injectable()
export class NotificationDispatcher {
    private readonly log = new Logger(NotificationDispatcher.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationService,
        private readonly pushSubscriptions: PushSubscriptionService,
    ) {}

    async handle(event: DomainEvent): Promise<void> {
        const payload = event.payload ?? {};
        // organizationId lives on the outbox row; fall back to the payload.
        const organizationId =
            event.organizationId ??
            (typeof payload.organizationId === 'string' ? payload.organizationId : undefined);
        if (!organizationId) return;

        // Dedup: at-least-once delivery means an event can be re-delivered.
        if (event.id) {
            const already = await this.prisma.notificationLog.findFirst({ where: { eventId: event.id } });
            if (already) {
                this.log.log(`event ${event.id} already dispatched; skipping`);
                return;
            }
        }

        switch (event.type) {
            case 'payment.confirmed':
                await this.notifyOrg(organizationId, 'payment.received', payload, event.id);
                break;
            case 'stock.low':
                await this.notifyOrg(organizationId, 'stock.low', payload, event.id);
                break;
            case 'sale.created':
                // Only alert when the sale was flagged for a large variance.
                if (payload.flagged === true) {
                    await this.notifyOrg(organizationId, 'sale.variance', payload, event.id);
                }
                break;
            case 'sale.refunded':
                await this.notifyOrg(organizationId, 'refund', payload, event.id);
                break;
            default:
                // Unhandled event types are ignored (other consumers may handle them).
                break;
        }
    }

    /** Send a template to every member of the org over their available channels. */
    private async notifyOrg(
        organizationId: string,
        template: string,
        data: TemplateData,
        eventId?: string,
    ): Promise<void> {
        const recipients = await this.recipientsFor(organizationId);
        for (const r of recipients) {
            if (r.email) {
                await this.notifications.send({
                    organizationId,
                    userId: r.userId,
                    channel: 'email',
                    to: r.email,
                    template,
                    data,
                    eventId,
                });
            }
            if (r.phone) {
                await this.notifications.send({
                    organizationId,
                    userId: r.userId,
                    channel: 'whatsapp',
                    to: r.phone,
                    template,
                    data,
                    eventId,
                });
            }
        }
        if (recipients.length === 0) {
            this.log.warn(`No recipients for org ${organizationId} (${template})`);
        }

        // Web Push reaches browsers whose tab is closed — one send per registered
        // subscription, independent of who is a messaging recipient.
        await this.pushOrg(organizationId, template, data, eventId);
    }

    /** Push the template to every registered subscription in the org; prune the dead ones. */
    private async pushOrg(
        organizationId: string,
        template: string,
        data: TemplateData,
        eventId?: string,
    ): Promise<void> {
        const subs = await this.pushSubscriptions.forOrganization(organizationId);
        for (const s of subs) {
            const outcome = await this.notifications.send({
                organizationId,
                channel: 'webpush',
                to: JSON.stringify(s.subscription),
                template,
                data,
                eventId,
            });
            if (outcome.status === 'FAILED' && outcome.error?.startsWith(SUBSCRIPTION_GONE)) {
                await this.pushSubscriptions.pruneByEndpoint(s.endpoint);
            }
        }
    }

    private async recipientsFor(organizationId: string): Promise<Recipient[]> {
        const memberships = await this.prisma.membership.findMany({
            where: { organizationId },
            include: { user: true },
        });
        const byUser = new Map<string, Recipient>();
        for (const m of memberships) {
            byUser.set(m.userId, {
                userId: m.userId,
                email: m.user.email || undefined,
                phone: m.user.phone || undefined,
            });
        }
        return [...byUser.values()];
    }
}
