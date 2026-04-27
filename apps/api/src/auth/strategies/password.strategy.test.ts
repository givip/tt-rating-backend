import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// We use a partial mock so the real bcrypt still powers hash/compare for the
// "correct password" fixture path, but individual tests can replace a method
// via mockImplementationOnce to observe call args or stub cost.
vi.mock('bcrypt', async () => {
  const actual = await vi.importActual<typeof import('bcrypt')>('bcrypt');
  return {
    ...actual,
    hash: vi.fn(actual.hash),
    compare: vi.fn(actual.compare),
  };
});

import * as bcrypt from 'bcrypt';
import { PasswordStrategy, DUMMY_HASH, hashPassword } from './password.strategy';
import { TooManyRequestsException } from '../rate-limit.service';

const makePrisma = () => ({
  user: {
    findFirst: vi.fn(),
  },
});

const makeRateLimit = () => ({
  check: vi.fn().mockResolvedValue(undefined),
  record: vi.fn().mockResolvedValue(undefined),
});

const makeConfig = (overrides: Record<string, string | undefined> = {}) => ({
  get: vi.fn((key: string) => overrides[key]),
});

describe('PasswordStrategy', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let rateLimit: ReturnType<typeof makeRateLimit>;
  let config: ReturnType<typeof makeConfig>;
  let strategy: PasswordStrategy;

  // Fixture: a known-good password + its bcrypt hash at cost 4 (fast for tests).
  const PLAINTEXT = 'correct-horse';
  let KNOWN_HASH: string;

  beforeAll(async () => {
    KNOWN_HASH = await bcrypt.hash(PLAINTEXT, 4);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    rateLimit = makeRateLimit();
    config = makeConfig();
    strategy = new PasswordStrategy(
      prisma as any,
      rateLimit as any,
      config as any,
    );
  });

  // 1
  it('complete() calls rateLimit.check first and propagates TooManyRequests', async () => {
    rateLimit.check.mockRejectedValueOnce(
      new TooManyRequestsException('Too many failed attempts, try again later'),
    );

    await expect(
      strategy.complete({ identifier: 'a@b.com', credential: 'x' }),
    ).rejects.toThrow(TooManyRequestsException);

    expect(rateLimit.check).toHaveBeenCalledWith('a@b.com');
    // Must not reach DB or record any attempt when over limit
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(rateLimit.record).not.toHaveBeenCalled();
  });

  // 2
  it('complete() returns {userId, role} on correct password', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-A',
      email: 'a@b.com',
      phone: null,
      passwordHash: KNOWN_HASH,
      role: 'player',
    });

    const result = await strategy.complete({
      identifier: 'a@b.com',
      credential: PLAINTEXT,
    });

    expect(result).toEqual({ userId: 'user-A', role: 'player' });
  });

  // 3
  it('complete() records success=true on correct password', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-A',
      email: 'a@b.com',
      phone: null,
      passwordHash: KNOWN_HASH,
      role: 'admin',
    });

    await strategy.complete({
      identifier: 'a@b.com',
      credential: PLAINTEXT,
      meta: { ip: '10.0.0.1' },
    });

    expect(rateLimit.record).toHaveBeenCalledTimes(1);
    expect(rateLimit.record).toHaveBeenCalledWith('a@b.com', true, '10.0.0.1');
  });

  // 4
  it('complete() throws UnauthorizedException("Invalid credentials") on wrong password and records failure', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-A',
      email: 'a@b.com',
      phone: null,
      passwordHash: KNOWN_HASH,
      role: 'player',
    });

    await expect(
      strategy.complete({
        identifier: 'a@b.com',
        credential: 'wrong-password',
        meta: { ip: '10.0.0.2' },
      }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));

    expect(rateLimit.record).toHaveBeenCalledTimes(1);
    expect(rateLimit.record).toHaveBeenCalledWith('a@b.com', false, '10.0.0.2');
  });

  // 5
  it('complete() throws UnauthorizedException("Invalid credentials") when user is not found (same error message)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      strategy.complete({ identifier: 'nobody@b.com', credential: 'x' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));

    expect(rateLimit.record).toHaveBeenCalledTimes(1);
    expect(rateLimit.record).toHaveBeenCalledWith(
      'nobody@b.com',
      false,
      undefined,
    );
  });

  // 6
  it('complete() consumes bcrypt time even when user missing (timing-safe)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const compareMock = vi.mocked(bcrypt.compare);
    compareMock.mockClear();

    await expect(
      strategy.complete({ identifier: 'nobody@b.com', credential: 'x' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(compareMock).toHaveBeenCalledWith('x', DUMMY_HASH);
  });

  // 6b — also exercises the null-passwordHash branch (OAuth-only user)
  it('complete() uses DUMMY_HASH when user exists but has no passwordHash', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-A',
      email: 'a@b.com',
      phone: null,
      passwordHash: null,
      role: 'player',
    });
    const compareMock = vi.mocked(bcrypt.compare);
    compareMock.mockClear();

    await expect(
      strategy.complete({ identifier: 'a@b.com', credential: 'x' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));

    expect(compareMock).toHaveBeenCalledWith('x', DUMMY_HASH);
  });

  // 7
  it('complete() looks up user by email OR phone', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      strategy.complete({ identifier: '+15551234567', credential: 'x' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    const args = prisma.user.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({
      OR: [{ email: '+15551234567' }, { phone: '+15551234567' }],
    });
  });
});

describe('AUTH_PASSWORD_LOOKUP_FIELDS', () => {
  it('defaults to email,phone (parses both)', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { user: { findFirst } } as never;
    const rateLimit = { check: vi.fn(), record: vi.fn() } as never;
    const config = { get: () => undefined } as never;
    const strategy = new PasswordStrategy(prisma, rateLimit, config);

    await expect(
      strategy.complete({ identifier: 'a@b.c', credential: 'pw' }),
    ).rejects.toThrow();

    expect(findFirst).toHaveBeenCalledWith({
      where: { OR: [{ email: 'a@b.c' }, { phone: 'a@b.c' }] },
    });
  });

  it('honours AUTH_PASSWORD_LOOKUP_FIELDS=email (only email)', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { user: { findFirst } } as never;
    const rateLimit = { check: vi.fn(), record: vi.fn() } as never;
    const config = {
      get: (k: string) => (k === 'AUTH_PASSWORD_LOOKUP_FIELDS' ? 'email' : undefined),
    } as never;
    const strategy = new PasswordStrategy(prisma, rateLimit, config);

    await expect(
      strategy.complete({ identifier: 'a@b.c', credential: 'pw' }),
    ).rejects.toThrow();

    expect(findFirst).toHaveBeenCalledWith({
      where: { OR: [{ email: 'a@b.c' }] },
    });
  });

  it('honours AUTH_PASSWORD_LOOKUP_FIELDS=phone (only phone)', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { user: { findFirst } } as never;
    const rateLimit = { check: vi.fn(), record: vi.fn() } as never;
    const config = {
      get: (k: string) => (k === 'AUTH_PASSWORD_LOOKUP_FIELDS' ? 'phone' : undefined),
    } as never;
    const strategy = new PasswordStrategy(prisma, rateLimit, config);

    await expect(
      strategy.complete({ identifier: '+995591234567', credential: 'pw' }),
    ).rejects.toThrow();

    expect(findFirst).toHaveBeenCalledWith({
      where: { OR: [{ phone: '+995591234567' }] },
    });
  });

  it('throws on startup-style misconfiguration (unknown field)', async () => {
    const prisma = { user: { findFirst: vi.fn() } } as never;
    const rateLimit = { check: vi.fn(), record: vi.fn() } as never;
    const config = {
      get: (k: string) => (k === 'AUTH_PASSWORD_LOOKUP_FIELDS' ? 'username' : undefined),
    } as never;
    const strategy = new PasswordStrategy(prisma, rateLimit, config);
    await expect(
      strategy.complete({ identifier: 'x', credential: 'pw' }),
    ).rejects.toThrow(/Unknown lookup field/);
  });
});

describe('hashPassword', () => {
  it('produces a bcrypt hash that verifies against the plaintext', async () => {
    const hash = await hashPassword('hunter2', 4);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(await bcrypt.compare('hunter2', hash)).toBe(true);
    expect(await bcrypt.compare('wrong', hash)).toBe(false);
  });

  it('floors cost at MIN_BCRYPT_COST (12) when a lower value is passed', async () => {
    // Don't actually produce a cost-12 hash here — that's slow. Use the
    // bcrypt.hash mock (installed via vi.mock at the top of the file) to
    // capture the cost argument without running the KDF.
    const hashMock = vi.mocked(bcrypt.hash);
    hashMock.mockClear();
    hashMock.mockResolvedValueOnce('stub' as never);

    await hashPassword('x', 4);

    expect(hashMock).toHaveBeenCalledWith('x', 12);
  });
});
