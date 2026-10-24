import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

export class UpsertPayoutAccountDto {
    @ApiProperty({ description: 'Bank code (provider/CBN bank code).' })
    @IsString()
    @MinLength(1)
    bankCode: string;

    @ApiProperty({ example: 'Guaranty Trust Bank' })
    @IsString()
    @MinLength(1)
    bankName: string;

    @ApiProperty({ example: 'Marcel Ndanwe', description: 'Account holder name.' })
    @IsString()
    @MinLength(1)
    accountName: string;

    @ApiProperty({ example: '0123456789', description: 'Account number (digits only).' })
    @IsString()
    @Matches(/^\d{6,20}$/, { message: 'accountNumber must be 6-20 digits' })
    accountNumber: string;

    @ApiPropertyOptional({ example: 'NGN', description: 'Currency code (default NGN).' })
    @IsOptional()
    @IsString()
    @Length(3, 3)
    currency?: string;
}
