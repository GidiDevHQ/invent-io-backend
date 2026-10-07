import { IsEmail, IsString, MinLength } from "class-validator";

export class RegisterDto {
    @IsString()
    businessName: string;

    @IsString()
    name: string;

    @IsEmail()
    email: string;

    @IsString()
    @MinLength(8)
    password: string; 
}