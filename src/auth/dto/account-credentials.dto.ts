import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
    @ApiProperty({ description: 'The current password.' })
    @IsString()
    @MinLength(1)
    currentPassword: string;

    @ApiProperty({ description: 'The new password (min 8 characters).' })
    @IsString()
    @MinLength(8)
    newPassword: string;
}

export class ChangeEmailDto {
    @ApiProperty({ description: 'The current password (re-auth for a sensitive change).' })
    @IsString()
    @MinLength(1)
    currentPassword: string;

    @ApiProperty({ description: 'The new email address.' })
    @IsEmail()
    newEmail: string;
}
