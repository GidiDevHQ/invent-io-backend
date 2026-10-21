import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsString, Min, MinLength, ValidateNested } from 'class-validator';

export class SaleItemInput {
    @ApiProperty()
    @IsString()
    @MinLength(1)
    productId: string;

    @ApiProperty({ example: 2 })
    @IsInt()
    @Min(1)
    qty: number;
}

export class AllocatePaymentDto {
    @ApiProperty({ type: [SaleItemInput] })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => SaleItemInput)
    items: SaleItemInput[];

    @ApiProperty({ description: 'Client-generated; replaying returns the original sale.' })
    @IsString()
    @MinLength(1)
    idempotencyKey: string;
}
