import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';

function makeCtx(headers: Record<string, unknown>, reqOverrides: Record<string, unknown> = {}): ExecutionContext {
  const req = { headers, ...reqOverrides } as Record<string, unknown>;
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let tokens: { verifyAccess: ReturnType<typeof vi.fn> };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    tokens = { verifyAccess: vi.fn() };
    guard = new JwtAuthGuard(tokens as unknown as TokenService);
  });

  it('throws UnauthorizedException when Authorization header is missing', () => {
    expect(() => guard.canActivate(makeCtx({}))).toThrow(UnauthorizedException);
    expect(tokens.verifyAccess).not.toHaveBeenCalled();
  });

  it('throws when Authorization header is malformed (no Bearer prefix)', () => {
    expect(() => guard.canActivate(makeCtx({ authorization: 'Token foo' }))).toThrow(
      UnauthorizedException,
    );
    expect(tokens.verifyAccess).not.toHaveBeenCalled();
  });

  it('throws when TokenService rejects the token', () => {
    tokens.verifyAccess.mockImplementation(() => {
      throw new UnauthorizedException('Invalid or expired access token');
    });

    expect(() => guard.canActivate(makeCtx({ authorization: 'Bearer bad-jwt' }))).toThrow(
      UnauthorizedException,
    );
    expect(tokens.verifyAccess).toHaveBeenCalledWith('bad-jwt');
  });

  it('attaches req.user and returns true on valid token', () => {
    tokens.verifyAccess.mockReturnValue({ userId: 'user-A', role: 'admin' });
    const ctx = makeCtx({ authorization: 'Bearer good-jwt' });

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as { user?: unknown };
    expect(req.user).toEqual({ userId: 'user-A', role: 'admin' });
    expect(tokens.verifyAccess).toHaveBeenCalledWith('good-jwt');
  });

  it('accepts case-insensitive Bearer prefix and trims whitespace', () => {
    tokens.verifyAccess.mockReturnValue({ userId: 'user-A', role: 'player' });
    const ctx = makeCtx({ authorization: 'bearer   some-token' });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(tokens.verifyAccess).toHaveBeenCalledWith('some-token');
  });
});

describe('JwtAuthGuard cookie fallback', () => {
  function makeCtxWithCookies(
    headers: Record<string, string>,
    cookies: Record<string, string>,
  ): ExecutionContext {
    const req: any = { headers, cookies, user: undefined };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  it('reads token from auth_token cookie when no Authorization header', () => {
    const tokens = { verifyAccess: vi.fn().mockReturnValue({ userId: 'u1', role: 'player' }) } as unknown as TokenService;
    const guard = new JwtAuthGuard(tokens);

    const ctx = makeCtxWithCookies({}, { auth_token: 'cookie.tok' });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(tokens.verifyAccess).toHaveBeenCalledWith('cookie.tok');
  });

  it('prefers Authorization header over cookie when both present', () => {
    const tokens = { verifyAccess: vi.fn().mockReturnValue({ userId: 'u1', role: 'player' }) } as unknown as TokenService;
    const guard = new JwtAuthGuard(tokens);

    const ctx = makeCtxWithCookies(
      { authorization: 'Bearer header.tok' },
      { auth_token: 'cookie.tok' },
    );
    guard.canActivate(ctx);
    expect(tokens.verifyAccess).toHaveBeenCalledWith('header.tok');
  });

  it('throws when neither header nor cookie present', () => {
    const tokens = { verifyAccess: vi.fn() } as unknown as TokenService;
    const guard = new JwtAuthGuard(tokens);
    expect(() => guard.canActivate(makeCtxWithCookies({}, {}))).toThrow(UnauthorizedException);
  });
});
