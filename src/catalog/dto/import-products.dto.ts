import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ImportProductsDto {
    @ApiProperty({
        description:
            'Raw CSV text. Header row required; columns (case-insensitive): name, price, cost ' +
            '(required) and sku, barcode, unit (optional). price/cost are integer minor units.',
        example: 'name,sku,price,cost\nBar Soap,SOAP-001,150000,90000',
    })
    @IsString()
    @MinLength(1)
    csv: string;
}
