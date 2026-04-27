import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { ZodBody } from '../common/zod-swagger';
import { PrismaService } from '../common/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  AUTH_STRATEGY,
  AuthStrategy,
} from './strategies/auth-strategy.interface';
import { TokenService } from './token.service';
import {
  setAuthCookies,
  clearAuthCookies,
  cookieSecureFromEnv,
  cookieDomainFromEnv,
} from './cookie.util';

const InitiateDto = z.object({ identifier: z.string().min(1) });
const LoginDto = z.object({
  identifier: z.string().min(1),
  credential: z.string().min(1),
});
const RefreshDto = z.object({ refreshToken: z.string().min(1) });

/**
 * Parse with zod and translate `ZodError` to a NestJS `BadRequestException` so
 * we never leak zod internals through the HTTP response.
 */
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException('Invalid request body');
    }
    throw err;
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_STRATEGY) private strategy: AuthStrategy,
    private tokens: TokenService,
    private prisma: PrismaService,
  ) {}

  /**
   * Step 1 of a multi-step flow (e.g. OTP send). For single-step strategies
   * like password this is a no-op — the strategy simply doesn't implement
   * `initiate`. Always returns `{ ok: true }` to avoid revealing whether the
   * identifier maps to a real user.
   */
  @Post('initiate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Initiate auth flow (e.g. send OTP)' })
  @ZodBody(InitiateDto)
  async initiate(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    const { identifier } = parseBody(InitiateDto, body);
    if (this.strategy.initiate) {
      await this.strategy.initiate({ identifier, meta: { ip: req.ip } });
    }
    return { ok: true };
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete auth flow and receive tokens' })
  @ZodBody(LoginDto)
  async login(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { identifier, credential } = parseBody(LoginDto, body);
    const { userId, role } = await this.strategy.complete({
      identifier,
      credential,
      meta: { ip: req.ip },
    });
    const tokens = await this.tokens.issue(userId, role);
    setAuthCookies(reply, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTtlSeconds: tokens.expiresIn,
      refreshTtlSeconds: this.tokens.refreshTtlSeconds(),
      secure: cookieSecureFromEnv(),
      domain: cookieDomainFromEnv(),
    });
    return tokens;
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate refresh token, mint new access token' })
  @ZodBody(RefreshDto)
  async refresh(
    @Body() body: unknown,
    @Req() req: FastifyRequest & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = RefreshDto.safeParse(body);
    // Refresh accepts the token from EITHER the body OR the auth_refresh cookie.
    // Browsers will use the cookie path; mobile clients send it in the body.
    const refreshToken = parsed.success
      ? parsed.data.refreshToken
      : req.cookies?.auth_refresh;
    if (!refreshToken) {
      throw new BadRequestException('Missing refresh token');
    }
    const tokens = await this.tokens.rotate(refreshToken);
    setAuthCookies(reply, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTtlSeconds: tokens.expiresIn,
      refreshTtlSeconds: this.tokens.refreshTtlSeconds(),
      secure: cookieSecureFromEnv(),
      domain: cookieDomainFromEnv(),
    });
    return tokens;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Return profile of the authenticated user' })
  async me(
    @Req() req: FastifyRequest & { user: { userId: string; role: string } },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, phone: true, role: true, createdAt: true },
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke all refresh tokens for the caller' })
  async logout(
    @Req() req: FastifyRequest & { user: { userId: string; role: string } },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.tokens.revokeAll(req.user.userId);
    clearAuthCookies(reply, {
      secure: cookieSecureFromEnv(),
      domain: cookieDomainFromEnv(),
    });
    return { ok: true };
  }
}
