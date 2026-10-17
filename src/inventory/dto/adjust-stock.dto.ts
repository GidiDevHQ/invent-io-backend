import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, MinLength } from 'class-validator';

/** Movement types permitted for a manual adjustment (not SALE / TRANSFER_*). */
export enum AdjustmentType {
    RESTOCK = 'RESTOCK',
    ADJUSTMENT = 'ADJUSTMENT',
    RETURN = 'RETURN',
}

export class AdjustStockDto {
    @ApiProperty()
    @IsString()
    @MinLength(1)
    branchId: string;

    @ApiProperty()
    @IsString()
    @MinLength(1)
    productId: string;

    @ApiProperty({ enum: AdjustmentType })
    @IsEnum(AdjustmentType)
    type: AdjustmentType;

    @ApiProperty({ example: 10, description: 'Signed change in units (negative to decrease).' })
    @IsInt()
    qtyDelta: number;

    @ApiProperty({ example: 'Received supplier delivery', description: 'Required reason for the adjustment.' })
    @IsString()
    @MinLength(1)
    reason: string;
}
