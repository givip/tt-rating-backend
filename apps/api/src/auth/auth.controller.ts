import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { ZodBody } from '../common/zod-swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  AUTH_STRATEGY,
  AuthStrategy,
} from './strategies/auth-strategy.interface';
import { TokenService } from './token.service';

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
  ) {
    const { identifier, credential } = parseBody(LoginDto, body);
    const { userId, role } = await this.strategy.complete({
      identifier,
      credential,
      meta: { ip: req.ip },
    });
    return this.tokens.issue(userId, role);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate refresh token, mint new access token' })
  @ZodBody(RefreshDto)
  async refresh(@Body() body: unknown) {
    const { refreshToken } = parseBody(RefreshDto, body);
    return this.tokens.rotate(refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke all refresh tokens for the caller' })
  async logout(
    @Req() req: FastifyRequest & { user: { userId: string; role: string } },
  ): Promise<{ ok: true }> {
    await this.tokens.revokeAll(req.user.userId);
    return { ok: true };
  }
}
