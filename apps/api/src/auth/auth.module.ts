import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import {
  SMS_PROVIDER,
} from '../notifications/sms-provider.interface';
import { ConsoleSmsProvider } from '../notifications/console-sms.provider';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RateLimitService } from './rate-limit.service';
import { RolesGuard } from './roles.guard';
import {
  AUTH_STRATEGY,
} from './strategies/auth-strategy.interface';
import { PasswordStrategy } from './strategies/password.strategy';
import { PhoneOtpStrategy } from './strategies/phone-otp.strategy';
import { RegisterService } from './register.service';
import {
  TOKEN_CONFIG_SERVICE,
  TokenConfigService,
  TokenService,
} from './token.service';

/**
 * Thin `TokenConfigService` over `process.env`. Chosen over @nestjs/config to
 * keep the dependency surface small for self-hosters — env vars are the
 * universal contract. Swap this provider for a real ConfigService adapter if
 * the platform needs hot-reload or validation.
 */
const envConfig: TokenConfigService = {
  get: <T = string>(key: string): T | undefined =>
    process.env[key] as T | undefined,
};

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret:
          process.env.JWT_SECRET ??
          (process.env.NODE_ENV === 'production'
            ? (() => {
                throw new Error('JWT_SECRET is required in production');
              })()
            : 'dev-secret-change-in-production'),
        // expiresIn is managed per-sign call by TokenService.
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    PrismaService,
    TokenService,
    RateLimitService,
    JwtAuthGuard,
    RolesGuard,
    PasswordStrategy,
    PhoneOtpStrategy,
    RegisterService,
    { provide: TOKEN_CONFIG_SERVICE, useValue: envConfig },
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
    // Active strategy — selected by AUTH_STRATEGY env var. Default 'password'.
    {
      provide: AUTH_STRATEGY,
      inject: [PasswordStrategy, PhoneOtpStrategy],
      useFactory: (pwd: PasswordStrategy, otp: PhoneOtpStrategy) => {
        const name = process.env.AUTH_STRATEGY ?? 'password';
        switch (name) {
          case 'password':
            return pwd;
          case 'phone-otp':
            return otp;
          default:
            throw new Error(`Unknown AUTH_STRATEGY: ${name}`);
        }
      },
    },
  ],
  // PrismaService is re-exported so downstream modules (players, tournaments,
  // clubs, admin) can inject it without each declaring their own provider.
  // Guards are exported so controllers in those modules can @UseGuards(...).
  exports: [TokenService, PrismaService, JwtModule, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
