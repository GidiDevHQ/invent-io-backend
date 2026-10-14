import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SetThresholdDto {
    @ApiProperty({ example: 5, description: 'Alert when stock is at or below this (0 disables).' })
    @IsInt()
    @Min(0)
    lowStockThreshold: number;
}
