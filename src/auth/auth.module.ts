import { Module } from "@nestjs/common";
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { RefreshTokenService } from "./refresh-token.service";
import { EmailVerificationService } from "./email-verification.service";
import { PasswordResetService } from "./password-reset.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { PassportModule } from "@nestjs/passport";
import { JwtStrategy } from "./strategies/jwt.strategy";

@Module({
    imports: [
        PassportModule,
        NotificationsModule, // account emails go out through the notification channels
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('JWT_SECRET'),
                // Short-lived: there is no access-token revocation list, so logout
                // and role changes take effect within this window. Refresh tokens
                // (rotated, revocable) provide the long-lived session.
                signOptions: { expiresIn: '15m' },
            })
        })
    ],
    providers: [AuthService, RefreshTokenService, EmailVerificationService, PasswordResetService, JwtStrategy],
    controllers: [AuthController],
    exports: [AuthService],
})
export class AuthModule {}