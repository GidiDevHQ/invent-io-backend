import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import type { PushSubscriptionJSON } from './channels/webpush.channel';
import { RegisterPushSubscriptionDto } from './dto/push-subscription.dto';

/**
 * Stores Web Push subscriptions (one per browser/device per user) and hands them
 * to the dispatcher at send time. The endpoint is globally unique, so the same
 * browser re-registering upserts rather than duplicates.
 */
@Injectable()
export class PushSubscriptionService {
    private readonly log = new Logger(PushSubscriptionService.name);

    constructor(private readonly prisma: PrismaService) {}

    /** Register (or refresh) the current user's subscription for this browser. */
    async register(tenant: TenantContext, dto: RegisterPushSubscriptionDto) {
        const sub = await this.prisma.pushSubscription.upsert({
            where: { endpoint: dto.endpoint },
            create: {
                userId: tenant.userId,
                organizationId: tenant.organizationId,
                endpoint: dto.endpoint,
                p256dh: dto.keys.p256dh,
                auth: dto.keys.auth,
            },
            // Re-subscribing can rotate keys and move the endpoint to another
            // user/org (shared device); keep the row pointing at who holds it now.
            update: {
                userId: tenant.userId,
                organizationId: tenant.organizationId,
                p256dh: dto.keys.p256dh,
                auth: dto.keys.auth,
            },
        });
        return { id: sub.id, endpoint: sub.endpoint };
    }

    /** Remove a subscription by endpoint (user unsubscribed in the browser). */
    async unregister(tenant: TenantContext, endpoint: string) {
        await this.prisma.pushSubscription.deleteMany({
            where: { endpoint, organizationId: tenant.organizationId },
        });
        return { removed: true };
    }

    /** All subscriptions for an organization, as web-push-ready JSON objects. */
    async forOrganization(
        organizationId: string,
    ): Promise<{ endpoint: string; subscription: PushSubscriptionJSON }[]> {
        const rows = await this.prisma.pushSubscription.findMany({ where: { organizationId } });
        return rows.map((r) => ({
            endpoint: r.endpoint,
            subscription: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        }));
    }

    /** Subscriptions for specific users, as web-push-ready JSON objects. */
    async forUsers(
        userIds: string[],
    ): Promise<{ endpoint: string; subscription: PushSubscriptionJSON }[]> {
        if (userIds.length === 0) return [];
        const rows = await this.prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
        return rows.map((r) => ({
            endpoint: r.endpoint,
            subscription: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        }));
    }

    /** Drop a subscription the push service reported as gone (404/410). */
    async pruneByEndpoint(endpoint: string): Promise<void> {
        await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
        this.log.log(`pruned gone push subscription`);
    }
}
