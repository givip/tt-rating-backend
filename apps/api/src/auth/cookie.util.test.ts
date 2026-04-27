import { describe, it, expect } from 'vitest';
import { setAuthCookies, clearAuthCookies } from './cookie.util';

type Cookie = { name: string; value: string; options: Record<string, unknown> };

function makeReply() {
  const cookies: Cookie[] = [];
  const reply = {
    setCookie: (name: string, value: string, options: Record<string, unknown>) => {
      cookies.push({ name, value, options });
      return reply;
    },
    clearCookie: (name: string, options: Record<string, unknown>) => {
      cookies.push({ name, value: '', options: { ...options, cleared: true } });
      return reply;
    },
  };
  return { reply, cookies };
}

describe('setAuthCookies', () => {
  it('sets auth_token and auth_refresh with correct attributes', () => {
    const { reply, cookies } = makeReply();

    setAuthCookies(reply as never, {
      accessToken: 'a.tok',
      refreshToken: 'r.tok',
      accessTtlSeconds: 900,
      refreshTtlSeconds: 2_592_000,
      secure: true,
    });

    expect(cookies).toHaveLength(2);

    const access = cookies.find((c) => c.name === 'auth_token')!;
    expect(access.value).toBe('a.tok');
    expect(access.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 900,
    });

    const refresh = cookies.find((c) => c.name === 'auth_refresh')!;
    expect(refresh.value).toBe('r.tok');
    expect(refresh.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 2_592_000,
    });
  });

  it('omits secure when secure=false (dev mode)', () => {
    const { reply, cookies } = makeReply();
    setAuthCookies(reply as never, {
      accessToken: 'a',
      refreshToken: 'r',
      accessTtlSeconds: 60,
      refreshTtlSeconds: 60,
      secure: false,
    });
    expect(cookies[0].options.secure).toBe(false);
  });

  it('sets domain when provided', () => {
    const { reply, cookies } = makeReply();
    setAuthCookies(reply as never, {
      accessToken: 'a',
      refreshToken: 'r',
      accessTtlSeconds: 60,
      refreshTtlSeconds: 60,
      secure: true,
      domain: '.ttr.ge',
    });
    expect(cookies[0].options.domain).toBe('.ttr.ge');
  });
});

describe('clearAuthCookies', () => {
  it('clears both cookies with matching paths', () => {
    const { reply, cookies } = makeReply();
    clearAuthCookies(reply as never, { secure: true });
    expect(cookies).toHaveLength(2);
    expect(cookies[0].options).toMatchObject({ path: '/', cleared: true });
    expect(cookies[1].options).toMatchObject({ path: '/api/v1/auth', cleared: true });
  });
});
