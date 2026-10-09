import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateProductDto {
    @ApiPropertyOptional({ example: 'Bar Soap' })
    @IsOptional()
    @IsString()
    @MinLength(1)
    name?: string;

    @ApiPropertyOptional({ example: 'SOAP-001' })
    @IsOptional()
    @IsString()
    sku?: string;

    @ApiPropertyOptional({ example: '5901234123457' })
    @IsOptional()
    @IsString()
    barcode?: string;

    @ApiPropertyOptional({ example: 'piece' })
    @IsOptional()
    @IsString()
    unit?: string;

    @ApiPropertyOptional({ example: 150000, description: 'Price in integer minor units. Never a float.' })
    @IsOptional()
    @IsInt()
    @Min(0)
    price?: number;

    @ApiPropertyOptional({ example: 90000, description: 'Cost in integer minor units. Never a float.' })
    @IsOptional()
    @IsInt()
    @Min(0)
    cost?: number;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    active?: boolean;
}
