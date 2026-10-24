import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MinLength } from 'class-validator';

export class RequestOtpDto {
    @ApiProperty({ description: 'Email address or phone number to send the login code to.' })
    @IsString()
    @MinLength(1)
    identifier: string;
}

export class VerifyOtpDto {
    @ApiProperty({ description: 'The email or phone the code was sent to.' })
    @IsString()
    @MinLength(1)
    identifier: string;

    @ApiProperty({ example: '123456', description: 'The 6-digit code.' })
    @IsString()
    @Length(6, 6)
    code: string;
}
