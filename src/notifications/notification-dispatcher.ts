import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import type { TemplateData } from './templates';

export interface DomainEvent {
    type: string;
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
    ) {}

    async handle(event: DomainEvent): Promise<void> {
        const p = event.payload ?? {};
        const organizationId = typeof p.organizationId === 'string' ? p.organizationId : undefined;

        switch (event.type) {
            case 'payment.confirmed':
                if (organizationId) await this.notifyOrg(organizationId, 'payment.received', p);
                break;
            case 'stock.low':
                if (organizationId) await this.notifyOrg(organizationId, 'stock.low', p);
                break;
            case 'sale.created':
                // Only alert when the sale was flagged for a large variance.
                if (organizationId && p.flagged === true) {
                    await this.notifyOrg(organizationId, 'sale.variance', p);
                }
                break;
            case 'sale.refunded':
                if (organizationId) await this.notifyOrg(organizationId, 'refund', p);
                break;
            default:
                // Unhandled event types are ignored (other consumers may handle them).
                break;
        }
    }

    /** Send a template to every member of the org over their available channels. */
    private async notifyOrg(organizationId: string, template: string, data: TemplateData): Promise<void> {
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
                });
            }
        }
        if (recipients.length === 0) {
            this.log.warn(`No recipients for org ${organizationId} (${template})`);
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
