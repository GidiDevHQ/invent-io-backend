import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, IsString, MinLength, ValidateNested } from 'class-validator';

export class PushKeysDto {
    @ApiProperty({ description: 'Client public key (base64url) from PushManager.subscribe().' })
    @IsString()
    @MinLength(1)
    p256dh: string;

    @ApiProperty({ description: 'Client auth secret (base64url) from PushManager.subscribe().' })
    @IsString()
    @MinLength(1)
    auth: string;
}

export class RegisterPushSubscriptionDto {
    @ApiProperty({ description: 'Push service endpoint URL for this browser.' })
    @IsString()
    @MinLength(1)
    endpoint: string;

    @ApiProperty({ type: PushKeysDto })
    @IsObject()
    @ValidateNested()
    @Type(() => PushKeysDto)
    keys: PushKeysDto;
}

export class UnregisterPushSubscriptionDto {
    @ApiProperty({ description: 'The endpoint URL to remove.' })
    @IsString()
    @MinLength(1)
    endpoint: string;
}
