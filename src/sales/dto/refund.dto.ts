import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

export class RefundItemInput {
    @ApiProperty()
    @IsString()
    @MinLength(1)
    productId: string;

    @ApiProperty({ example: 1 })
    @IsInt()
    @Min(1)
    qty: number;
}

export class RefundDto {
    @ApiPropertyOptional({ type: [RefundItemInput], description: 'Lines to refund. Omit to refund the whole remaining sale.' })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RefundItemInput)
    items?: RefundItemInput[];

    @ApiPropertyOptional({ description: 'Why the refund was issued.' })
    @IsOptional()
    @IsString()
    reason?: string;
}
