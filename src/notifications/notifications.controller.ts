import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guards';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { PermissionGuard } from '../tenancy/permission.guard';
import { RequirePermission } from '../tenancy/require-permission.decorator';
import { Tenant } from '../tenancy/tenant.decorator';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { NotificationService } from './notification.service';
import { SendNotificationDto } from './dto/send-notification.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
export class NotificationsController {
    constructor(private readonly notifications: NotificationService) {}

    @Post('test')
    @RequirePermission('notifications.send')
    @ApiOperation({ summary: 'Send a templated notification over a channel (demo/verify)' })
    sendTest(@Tenant() tenant: TenantContext, @Body() dto: SendNotificationDto) {
        return this.notifications.send({
            organizationId: tenant.organizationId,
            userId: tenant.userId,
            channel: dto.channel,
            to: dto.to,
            template: dto.template,
            data: dto.data,
        });
    }
}
