import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guards';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { Tenant } from '../tenancy/tenant.decorator';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { PushSubscriptionService } from './push-subscription.service';
import { WebPushChannel } from './channels/webpush.channel';
import {
    RegisterPushSubscriptionDto,
    UnregisterPushSubscriptionDto,
} from './dto/push-subscription.dto';

/**
 * Browser Web Push subscription management. Any authenticated member may
 * register their own device (no special permission): the whole point is that
 * every role gets the "payment landed — what did you sell?" banner.
 */
@ApiTags('push')
@ApiBearerAuth()
@Controller('push')
@UseGuards(JwtAuthGuard, TenantContextGuard)
export class PushController {
    constructor(private readonly subscriptions: PushSubscriptionService) {}

    @Get('vapid-public-key')
    @ApiOperation({ summary: 'The VAPID public key the browser needs to subscribe' })
    vapidPublicKey() {
        return { publicKey: WebPushChannel.publicKey() ?? null };
    }

    @Post('subscriptions')
    @ApiOperation({ summary: 'Register this browser to receive push notifications' })
    register(@Tenant() tenant: TenantContext, @Body() dto: RegisterPushSubscriptionDto) {
        return this.subscriptions.register(tenant, dto);
    }

    @Delete('subscriptions')
    @HttpCode(200)
    @ApiOperation({ summary: 'Stop receiving push notifications on this browser' })
    unregister(@Tenant() tenant: TenantContext, @Body() dto: UnregisterPushSubscriptionDto) {
        return this.subscriptions.unregister(tenant, dto.endpoint);
    }
}
