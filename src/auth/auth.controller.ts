import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh.dto';
import { RefreshTokenService } from './refresh-token.service';

@Controller('auth')
export  class AuthController {
    constructor(
        private authService: AuthService,
        private refreshTokenService: RefreshTokenService
    ) {}

    @Post('register')
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('login')
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto)
    }

    @Post('refresh')
    async refresh(@Body() dto: RefreshTokenDto) {
        const { userId, newRawToken } = await this.refreshTokenService.rotate(dto.refreshToken);
        const accessToken = await this.authService.signAccessToken(userId);

        return { accessToken, refreshToken: newRawToken };
    }

    @Post('logout')
    async logout(@Body() dto: RefreshTokenDto) {
        await this.refreshTokenService.revokedByRawToken(dto.refreshToken);
        return { message: 'Logged out successfully' };
    }
}