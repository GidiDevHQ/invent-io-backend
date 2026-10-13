import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guards';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { PermissionGuard } from '../tenancy/permission.guard';
import { RequirePermission } from '../tenancy/require-permission.decorator';
import { Tenant } from '../tenancy/tenant.decorator';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { CatalogService } from './catalog.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('products')
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
export class CatalogController {
    constructor(private readonly catalog: CatalogService) {}

    @Post()
    @RequirePermission('catalog.write')
    @ApiOperation({ summary: 'Create a product' })
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateProductDto) {
        return this.catalog.create(tenant, dto);
    }

    @Get()
    @RequirePermission('catalog.read')
    @ApiOperation({ summary: 'List products (cursor-paginated)' })
    list(
        @Tenant() tenant: TenantContext,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ) {
        return this.catalog.list(tenant, {
            limit: limit ? Number(limit) : undefined,
            cursor,
        });
    }

    @Get(':id')
    @RequirePermission('catalog.read')
    @ApiOperation({ summary: 'Get a product by id' })
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.catalog.get(tenant, id);
    }

    @Patch(':id')
    @RequirePermission('catalog.write')
    @ApiOperation({ summary: 'Update a product (price/cost changes are audited)' })
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateProductDto,
    ) {
        return this.catalog.update(tenant, id, dto);
    }

    @Delete(':id')
    @RequirePermission('catalog.write')
    @ApiOperation({ summary: 'Deactivate (soft-retire) a product' })
    deactivate(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.catalog.deactivate(tenant, id);
    }
}
