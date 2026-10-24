import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
    @ApiProperty({ description: 'The account email to send a reset link to.' })
    @IsEmail()
    email: string;
}

export class ResetPasswordDto {
    @ApiProperty({ description: 'The raw token from the reset link.' })
    @IsString()
    @MinLength(1)
    token: string;

    @ApiProperty({ description: 'The new password (min 8 characters).' })
    @IsString()
    @MinLength(8)
    password: string;
}
