import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class SendNotificationDto {
    @ApiProperty({ enum: ['whatsapp', 'email', 'simulated'] })
    @IsIn(['whatsapp', 'email', 'simulated'])
    channel: 'whatsapp' | 'email' | 'simulated';

    @ApiProperty({ description: 'Phone number (whatsapp) or email address (email).' })
    @IsString()
    @MinLength(1)
    to: string;

    @ApiProperty({ example: 'payment.received' })
    @IsString()
    @MinLength(1)
    template: string;

    @ApiPropertyOptional({ description: 'Template variables, e.g. { amountMinor, currency }.' })
    @IsOptional()
    @IsObject()
    data?: Record<string, unknown>;
}
