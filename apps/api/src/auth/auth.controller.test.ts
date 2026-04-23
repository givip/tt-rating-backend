import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthController } from './auth.controller';
import type { AuthStrategy } from './strategies/auth-strategy.interface';
import type { TokenService } from './token.service';
import { TooManyRequestsException } from './rate-limit.service';

/**
 * Test scaffolding: instantiate the controller with mocked collaborators. We
 * don't spin up an HTTP server — the controller's @Body() / @Req() / @Headers()
 * decorators are extraction hints for Nest, but calling the methods directly
 * is equivalent because we pass the values positionally.
 */

function makeStrategy(overrides: Partial<AuthStrategy> = {}): AuthStrategy {
  return {
    name: 'mock',
    complete: vi.fn().mockResolvedValue({ userId: 'u1', role: 'player' }),
    ...overrides,
  } as AuthStrategy;
}

function makeTokens(): TokenService {
  return {
    issue: vi
      .fn()
      .mockResolvedValue({
        accessToken: 'a.tok',
        refreshToken: 'r.tok',
        expiresIn: 900,
      }),
    rotate: vi.fn().mockResolvedValue({
      accessToken: 'a2.tok',
      refreshToken: 'r2.tok',
      expiresIn: 900,
    }),
    verifyAccess: vi.fn().mockReturnValue({ userId: 'u1', role: 'player' }),
    revokeAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as TokenService;
}

function makeReq(ip = '10.0.0.1'): FastifyRequest {
  return { ip } as unknown as FastifyRequest;
}

describe('AuthController', () => {
  let strategy: AuthStrategy;
  let tokens: TokenService;
  let controller: AuthController;

  beforeEach(() => {
    strategy = makeStrategy({ initiate: vi.fn().mockResolvedValue(undefined) });
    tokens = makeTokens();
    controller = new AuthController(strategy, tokens);
  });

  describe('POST /initiate', () => {
    it('calls strategy.initiate with identifier and ip from request', async () => {
      const res = await controller.initiate(
        { identifier: '+995555123456' },
        makeReq('203.0.113.7'),
      );
      expect(strategy.initiate).toHaveBeenCalledWith({
        identifier: '+995555123456',
        meta: { ip: '203.0.113.7' },
      });
      expect(res).toEqual({ ok: true });
    });

    it('returns {ok: true} even if strategy.initiate is undefined (password case)', async () => {
      const pwdStrategy = makeStrategy(); // no initiate
      const c = new AuthController(pwdStrategy, tokens);
      const res = await c.initiate({ identifier: 'alice@example.com' }, makeReq());
      expect(res).toEqual({ ok: true });
      // No initiate method on the strategy means nothing to call.
      expect((pwdStrategy as { initiate?: unknown }).initiate).toBeUndefined();
    });

    it('returns 400-equivalent on invalid body (empty identifier)', async () => {
      await expect(
        controller.initiate({ identifier: '' }, makeReq()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns 400 on missing identifier field', async () => {
      await expect(
        controller.initiate({}, makeReq()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('POST /login', () => {
    it('returns access + refresh tokens on successful complete', async () => {
      const res = await controller.login(
        { identifier: 'alice@example.com', credential: 'hunter2' },
        makeReq('198.51.100.4'),
      );
      expect(strategy.complete).toHaveBeenCalledWith({
        identifier: 'alice@example.com',
        credential: 'hunter2',
        meta: { ip: '198.51.100.4' },
      });
      expect(tokens.issue).toHaveBeenCalledWith('u1', 'player');
      expect(res).toEqual({
        accessToken: 'a.tok',
        refreshToken: 'r.tok',
        expiresIn: 900,
      });
    });

    it('propagates UnauthorizedException from strategy.complete', async () => {
      (strategy.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new UnauthorizedException('Invalid credentials'),
      );
      await expect(
        controller.login(
          { identifier: 'a', credential: 'b' },
          makeReq(),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('propagates TooManyRequestsException', async () => {
      (strategy.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TooManyRequestsException(),
      );
      await expect(
        controller.login(
          { identifier: 'a', credential: 'b' },
          makeReq(),
        ),
      ).rejects.toBeInstanceOf(TooManyRequestsException);
    });

    it('returns 400 on invalid body', async () => {
      await expect(
        controller.login(
          { identifier: '', credential: '' },
          makeReq(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('POST /refresh', () => {
    it('returns new token pair from tokens.rotate', async () => {
      const res = await controller.refresh({ refreshToken: 'old.refresh' });
      expect(tokens.rotate).toHaveBeenCalledWith('old.refresh');
      expect(res).toEqual({
        accessToken: 'a2.tok',
        refreshToken: 'r2.tok',
        expiresIn: 900,
      });
    });

    it('propagates UnauthorizedException from rotate', async () => {
      (tokens.rotate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new UnauthorizedException('Invalid refresh token'),
      );
      await expect(
        controller.refresh({ refreshToken: 'bad' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns 400 on invalid body', async () => {
      await expect(
        controller.refresh({ refreshToken: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('POST /logout', () => {
    // Bearer extraction and token verification now live in JwtAuthGuard
    // (see jwt-auth.guard.test.ts). The controller just reads req.user and
    // revokes — anything auth-guard related is covered one layer up.
    it('calls tokens.revokeAll with req.user.userId', async () => {
      const req = { user: { userId: 'u1', role: 'player' } } as any;
      const res = await controller.logout(req);

      expect(tokens.revokeAll).toHaveBeenCalledWith('u1');
      expect(res).toEqual({ ok: true });
    });
  });
});
