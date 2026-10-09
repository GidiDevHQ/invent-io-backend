import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateProductDto {
    @ApiProperty({ example: 'Bar Soap' })
    @IsString()
    @MinLength(1)
    name: string;

    @ApiPropertyOptional({ example: 'SOAP-001' })
    @IsOptional()
    @IsString()
    sku?: string;

    @ApiPropertyOptional({ example: '5901234123457' })
    @IsOptional()
    @IsString()
    barcode?: string;

    @ApiPropertyOptional({ example: 'piece', description: 'Unit of sale, e.g. "piece", "kg"' })
    @IsOptional()
    @IsString()
    unit?: string;

    @ApiProperty({
        example: 150000,
        description: 'Price in integer minor units (e.g. kobo), in the org currency. Never a float.',
    })
    @IsInt()
    @Min(0)
    price: number;

    @ApiProperty({ example: 90000, description: 'Cost in integer minor units. Never a float.' })
    @IsInt()
    @Min(0)
    cost: number;
}
