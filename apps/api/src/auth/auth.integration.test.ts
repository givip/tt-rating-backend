import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupAuthApp, teardownAuthApp, type AuthAppHandle } from './__test-utils__/auth-app';
import { truncateAuthData } from '../tournaments/__test-utils__/setup';
import { hashPassword } from './strategies/password.strategy';

let h: AuthAppHandle;

const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASS = 'admin-pass-1234';

async function injectJson(opts: {
  method: 'GET' | 'POST';
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const res = await h.app.inject({
    method: opts.method,
    url: opts.url,
    payload: opts.body == null ? undefined : (opts.body as never),
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
  });
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.payload ? JSON.parse(res.payload) : undefined,
  };
}

function parseSetCookieHeader(raw: string | string[] | undefined): Record<string, string> {
  if (!raw) return {};
  const list = Array.isArray(raw) ? raw : [raw];
  const out: Record<string, string> = {};
  for (const c of list) {
    const [pair] = c.split(';');
    const [name, ...rest] = pair.split('=');
    out[name.trim()] = rest.join('=');
  }
  return out;
}

beforeAll(async () => {
  h = await setupAuthApp();
}, 60_000);

afterAll(async () => {
  await teardownAuthApp(h);
});

beforeEach(async () => {
  await truncateAuthData(h.prisma);
});

describe('auth integration', () => {
  it('login -> me (cookie) -> me (Bearer) -> refresh -> logout', async () => {
    await h.prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash: await hashPassword(ADMIN_PASS),
        role: 'admin',
      },
    });

    // 1. Login.
    const login = await injectJson({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { identifier: ADMIN_EMAIL, credential: ADMIN_PASS },
    });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: expect.any(Number),
    });
    const cookies = parseSetCookieHeader(login.headers['set-cookie']);
    expect(cookies.auth_token).toBeDefined();
    expect(cookies.auth_refresh).toBeDefined();

    // 2. Me with cookie.
    const meCookie = await injectJson({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `auth_token=${cookies.auth_token}` },
    });
    expect(meCookie.status).toBe(200);
    expect(meCookie.body).toMatchObject({ email: ADMIN_EMAIL, role: 'admin' });

    // 3. Me with Bearer.
    const meBearer = await injectJson({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${login.body.accessToken}` },
    });
    expect(meBearer.status).toBe(200);

    // 4. Me with neither -> 401.
    const meNone = await injectJson({ method: 'GET', url: '/api/v1/auth/me' });
    expect(meNone.status).toBe(401);

    // 5. Refresh via cookie.
    const refresh = await injectJson({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      body: {},
      headers: { cookie: `auth_refresh=${cookies.auth_refresh}` },
    });
    expect(refresh.status).toBe(200);
    // JWT iat/exp are whole-second precision, so accessTokens issued in the
    // same second can collide. Refresh tokens are crypto-random per call, so
    // they always differ — that's the strict signal that rotation worked.
    expect(refresh.body.refreshToken).not.toBe(login.body.refreshToken);

    // 6. Logout.
    const logout = await injectJson({
      method: 'POST',
      url: '/api/v1/auth/logout',
      body: {},
      headers: { authorization: `Bearer ${login.body.accessToken}` },
    });
    expect(logout.status).toBe(200);
  });

  it('login: wrong password -> 401', async () => {
    await h.prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash: await hashPassword(ADMIN_PASS),
        role: 'admin',
      },
    });
    const login = await injectJson({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { identifier: ADMIN_EMAIL, credential: 'wrong' },
    });
    expect(login.status).toBe(401);
  });

  it('login: unknown identifier -> 401', async () => {
    const login = await injectJson({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { identifier: 'nobody@nowhere', credential: 'whatever' },
    });
    expect(login.status).toBe(401);
  });

  it('register: invalid invite -> 400', async () => {
    const res = await injectJson({
      method: 'POST',
      url: '/api/v1/auth/register',
      body: {
        identifier: 'newuser@test',
        credential: 'pw12345678',
        name: 'New User',
        inviteCode: 'NOPE',
      },
    });
    expect(res.status).toBe(400);
  });

  it('admin/invites: non-admin -> 403', async () => {
    await h.prisma.user.create({
      data: { email: 'player@test', passwordHash: await hashPassword('pw12345678'), role: 'player' },
    });
    const login = await injectJson({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { identifier: 'player@test', credential: 'pw12345678' },
    });
    const res = await injectJson({
      method: 'POST',
      url: '/api/v1/admin/invites',
      body: { role: 'organizer', expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      headers: { authorization: `Bearer ${login.body.accessToken}` },
    });
    expect(res.status).toBe(403);
  });

  it('admin/invites + register: full happy path', async () => {
    await h.prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash: await hashPassword(ADMIN_PASS),
        role: 'admin',
      },
    });
    const adminLogin = await injectJson({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { identifier: ADMIN_EMAIL, credential: ADMIN_PASS },
    });

    // Create invite.
    const invite = await injectJson({
      method: 'POST',
      url: '/api/v1/admin/invites',
      body: {
        role: 'organizer',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      headers: { authorization: `Bearer ${adminLogin.body.accessToken}` },
    });
    expect(invite.status).toBe(201);
    const code = invite.body.code as string;

    // Register with the code.
    const reg = await injectJson({
      method: 'POST',
      url: '/api/v1/auth/register',
      body: {
        identifier: 'newbie@test',
        credential: 'pw12345678',
        name: 'Newbie',
        inviteCode: code,
      },
    });
    expect(reg.status).toBe(200);
    expect(reg.body.user.role).toBe('organizer');

    // Re-using the same code fails.
    const dup = await injectJson({
      method: 'POST',
      url: '/api/v1/auth/register',
      body: {
        identifier: 'someone-else@test',
        credential: 'pw12345678',
        name: 'X',
        inviteCode: code,
      },
    });
    expect(dup.status).toBe(400);
  });
});
