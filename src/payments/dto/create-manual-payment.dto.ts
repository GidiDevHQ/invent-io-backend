import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateManualPaymentDto {
    @ApiProperty({
        description: 'Amount received in minor currency units (kobo), as a positive integer string.',
        example: '125000',
    })
    @IsString()
    @Matches(/^[1-9]\d*$/)
    amountMinor: string;

    @ApiPropertyOptional({ description: 'Branch that received the cash; defaults to the tenant branch.' })
    @IsOptional()
    @IsString()
    @MinLength(1)
    branchId?: string;
}
