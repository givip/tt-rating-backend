import type { FastifyReply } from 'fastify';

export const ACCESS_COOKIE = 'auth_token';
export const REFRESH_COOKIE = 'auth_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface SetAuthCookiesInput {
  accessToken: string;
  refreshToken: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  secure: boolean;
  domain?: string;
}

export function setAuthCookies(reply: FastifyReply, input: SetAuthCookiesInput): void {
  const base = {
    httpOnly: true,
    secure: input.secure,
    sameSite: 'lax' as const,
    ...(input.domain ? { domain: input.domain } : {}),
  };

  reply.setCookie(ACCESS_COOKIE, input.accessToken, {
    ...base,
    path: '/',
    maxAge: input.accessTtlSeconds,
  });

  reply.setCookie(REFRESH_COOKIE, input.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: input.refreshTtlSeconds,
  });
}

export interface ClearAuthCookiesInput {
  secure: boolean;
  domain?: string;
}

export function clearAuthCookies(reply: FastifyReply, input: ClearAuthCookiesInput): void {
  const base = {
    httpOnly: true,
    secure: input.secure,
    sameSite: 'lax' as const,
    ...(input.domain ? { domain: input.domain } : {}),
  };

  reply.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
}

export function cookieSecureFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.COOKIE_SECURE != null) return env.COOKIE_SECURE === 'true';
  return env.NODE_ENV === 'production';
}

export function cookieDomainFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.COOKIE_DOMAIN || undefined;
}
