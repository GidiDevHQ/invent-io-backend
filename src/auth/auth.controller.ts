import { Controller, Post, Body, HttpCode, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { RefreshTokenService } from './refresh-token.service';
import { EmailVerificationService } from './email-verification.service';
import { JwtAuthGuard } from './guards/jwt-auth.guards';

@Controller('auth')
export  class AuthController {
    constructor(
        private authService: AuthService,
        private refreshTokenService: RefreshTokenService,
        private emailVerification: EmailVerificationService,
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

    @Post('verify-email')
    @HttpCode(200)
    @ApiOperation({ summary: 'Confirm an email address from the verification link token' })
    verifyEmail(@Body() dto: VerifyEmailDto) {
        // Public: the single-use token in the link is itself the proof.
        return this.emailVerification.verify(dto.token);
    }

    @Post('verify-email/resend')
    @HttpCode(200)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Resend the verification email to the logged-in user (throttled)' })
    resendVerification(@Req() req: { user: { userId: string } }) {
        return this.emailVerification.resend(req.user.userId);
    }
}