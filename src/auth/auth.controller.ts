import { Controller, Post, Body, HttpCode, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthThrottle } from './auth-throttle.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { RequestOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { ChangeEmailDto, ChangePasswordDto } from './dto/account-credentials.dto';
import { RefreshTokenService } from './refresh-token.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import { OtpService } from './otp.service';
import { AccountCredentialsService } from './account-credentials.service';
import { JwtAuthGuard } from './guards/jwt-auth.guards';

@Controller('auth')
export  class AuthController {
    constructor(
        private authService: AuthService,
        private refreshTokenService: RefreshTokenService,
        private emailVerification: EmailVerificationService,
        private passwordReset: PasswordResetService,
        private otp: OtpService,
        private accountCredentials: AccountCredentialsService,
    ) {}

    @Post('register')
    @AuthThrottle(5)
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('login')
    @AuthThrottle(10)
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto)
    }

    @Post('refresh')
    @AuthThrottle()
    async refresh(@Body() dto: RefreshTokenDto) {
        const { userId, newRawToken } = await this.refreshTokenService.rotate(dto.refreshToken);
        const accessToken = await this.authService.signAccessToken(userId);

        return { accessToken, refreshToken: newRawToken };
    }

    @Post('logout')
    @AuthThrottle()
    async logout(@Body() dto: RefreshTokenDto) {
        await this.refreshTokenService.revokedByRawToken(dto.refreshToken);
        return { message: 'Logged out successfully' };
    }

    @Post('verify-email')
    @AuthThrottle()
    @HttpCode(200)
    @ApiOperation({ summary: 'Confirm an email address from the verification link token' })
    verifyEmail(@Body() dto: VerifyEmailDto) {
        // Public: the single-use token in the link is itself the proof.
        return this.emailVerification.verify(dto.token);
    }

    @Post('verify-email/resend')
    @AuthThrottle()
    @HttpCode(200)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Resend the verification email to the logged-in user (throttled)' })
    resendVerification(@Req() req: { user: { userId: string } }) {
        return this.emailVerification.resend(req.user.userId);
    }

    @Post('forgot-password')
    @AuthThrottle()
    @HttpCode(200)
    @ApiOperation({ summary: 'Email a password-reset link (always succeeds; no account enumeration)' })
    forgotPassword(@Body() dto: ForgotPasswordDto) {
        return this.passwordReset.request(dto.email);
    }

    @Post('reset-password')
    @AuthThrottle()
    @HttpCode(200)
    @ApiOperation({ summary: 'Set a new password from a reset-link token; revokes all sessions' })
    resetPassword(@Body() dto: ResetPasswordDto) {
        return this.passwordReset.reset(dto.token, dto.password);
    }

    @Post('otp/request')
    @AuthThrottle()
    @HttpCode(200)
    @ApiOperation({ summary: 'Email/text a 6-digit login code (always succeeds; no account enumeration)' })
    requestOtp(@Body() dto: RequestOtpDto) {
        return this.otp.request(dto.identifier);
    }

    @Post('otp/verify')
    @AuthThrottle()
    @HttpCode(200)
    @ApiOperation({ summary: 'Exchange a valid login code for a session' })
    verifyOtp(@Body() dto: VerifyOtpDto) {
        return this.otp.verify(dto.identifier, dto.code);
    }

    @Post('change-password')
    @HttpCode(200)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Change password (requires current password); revokes all sessions' })
    changePassword(@Req() req: { user: { userId: string } }, @Body() dto: ChangePasswordDto) {
        return this.accountCredentials.changePassword(req.user.userId, dto.currentPassword, dto.newPassword);
    }

    @Post('change-email')
    @HttpCode(200)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Change email (requires current password); re-sends verification' })
    changeEmail(@Req() req: { user: { userId: string } }, @Body() dto: ChangeEmailDto) {
        return this.accountCredentials.changeEmail(req.user.userId, dto.currentPassword, dto.newEmail);
    }
}