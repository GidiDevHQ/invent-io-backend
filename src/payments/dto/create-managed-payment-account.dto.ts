import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateManagedPaymentAccountDto {
    @ApiProperty({ example: 'Example Business Ltd' })
    @IsString()
    @MinLength(2)
    businessName: string;

    @ApiProperty({ example: '058', description: 'Paystack settlement-bank code' })
    @IsString()
    @Matches(/^\d{3,5}$/)
    settlementBankCode: string;

    @ApiProperty({ example: '0123456789' })
    @IsString()
    @Matches(/^\d{8,20}$/)
    settlementAccountNumber: string;

    @ApiProperty({ example: 'owner@example.com' })
    @IsEmail()
    ownerEmail: string;

    @ApiProperty({ example: 'Ada Owner' })
    @IsString()
    @MinLength(2)
    ownerName: string;

    @ApiProperty({ example: 'Ada' })
    @IsString()
    @MinLength(1)
    customerFirstName: string;

    @ApiProperty({ example: 'Owner' })
    @IsString()
    @MinLength(1)
    customerLastName: string;

    @ApiPropertyOptional({ example: '+2348012345678' })
    @IsOptional()
    @IsString()
    ownerPhone?: string;

    @ApiPropertyOptional({ example: 'wema-bank' })
    @IsOptional()
    @IsString()
    preferredBank?: string;

    @ApiProperty({
        description: 'Confirms the organization is authorized to submit these details to Paystack.',
        example: true,
    })
    @IsBoolean()
    ownerConsent: boolean;
}
