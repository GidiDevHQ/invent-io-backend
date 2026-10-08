import {
    CanActivate,
    ExecutionContext,
    Injectable,
    ForbiddenException
} from '@nestjs/common';
import { Reflector } from "@nestjs/core";
import { PERMISSION_KEY } from "./require-permission.decorator";

@Injectable()
export class PermissionGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const required = this.reflector.get<string>(PERMISSION_KEY, context.getHandler());

        if (!required) {
            return true;
        }

        const req =  context.switchToHttp().getRequest();
        const tenant = req.tenant;

        if (!tenant) {
            throw new ForbiddenException('Tenant context is missing');
        }

        const allowed = 
        tenant.permissions.includes('*') ||
        tenant.permissions.includes(required);

        if (!allowed) {
            throw new ForbiddenException(`Missing permission: ${required}`);
        }

        return true;
    }
}