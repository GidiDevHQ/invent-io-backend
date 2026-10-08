import { Controller, Get, UseGuards, Req } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guards";
import { TenantContextGuard } from "./tenant-context.guard";
import { PermissionGuard } from "./permission.guard";
import { RequirePermission } from "./require-permission.decorator";

@Controller('tenancy')
export class TenancyController {
    @Get('me')
    @UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
    @RequirePermission('*')
    me(@Req() req: any) {
        return req.tenant;
    }
}