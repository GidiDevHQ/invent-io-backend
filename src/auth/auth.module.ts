import { Module } from "@nestjs/common";
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { RefreshTokenService } from "./refresh-token.service";
import { PassportModule } from "@nestjs/passport";
import { JwtStrategy } from "./strategies/jwt.strategy";

@Module({
    imports: [
        PassportModule,
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
    providers: [AuthService, RefreshTokenService, JwtStrategy],
    controllers: [AuthController],
    exports: [AuthService],
})
export class AuthModule {}