import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TokenService } from './token.service';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

type PrismaTxClient = {
  refreshToken: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

const makePrisma = () => {
  const tx: PrismaTxClient = {
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  // `prisma.refreshToken` is SEPARATE from `tx.refreshToken` so tests can
  // distinguish inside-txn writes from post-txn writes (chain revocation on
  // reuse must happen outside the txn so it isn't rolled back by the throw).
  const outerRefreshToken = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };

  const prisma = {
    refreshToken: outerRefreshToken,
    // Pass-through transaction: run the callback with the tx mocks.
    $transaction: vi.fn(async (cb: (client: PrismaTxClient) => Promise<unknown>) => cb(tx)),
  };

  return { prisma, tx };
};

const makeJwt = () => ({
  sign: vi.fn().mockReturnValue('signed.jwt.token'),
  verify: vi.fn(),
});

const makeConfig = (overrides: Record<string, string | undefined> = {}) => ({
  get: vi.fn((key: string) => overrides[key]),
});

describe('TokenService', () => {
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let tx: ReturnType<typeof makePrisma>['tx'];
  let jwt: ReturnType<typeof makeJwt>;
  let config: ReturnType<typeof makeConfig>;
  let service: TokenService;

  beforeEach(() => {
    vi.clearAllMocks();
    const p = makePrisma();
    prisma = p.prisma;
    tx = p.tx;
    jwt = makeJwt();
    config = makeConfig();
    service = new TokenService(prisma as any, jwt as any, config as any);
  });

  // 1
  it('issue() returns access and refresh tokens and persists sha256 hash of refresh', async () => {
    prisma.refreshToken.create.mockImplementation(async ({ data }: any) => ({
      id: 'new-id',
      ...data,
    }));

    const result = await service.issue('user-A', 'player');

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken.length).toBeGreaterThan(30); // base64url of 32 bytes
    expect(result.expiresIn).toBe(900); // 15m default

    // Access JWT was signed with sub/role and correct ttl
    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: 'user-A', role: 'player' },
      { expiresIn: 900 },
    );

    // Refresh token was stored as sha256 hex (NOT plaintext)
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.refreshToken.create.mock.calls[0][0];
    expect(createArgs.data.userId).toBe('user-A');
    expect(createArgs.data.tokenHash).toBe(sha256Hex(result.refreshToken));
    expect(createArgs.data.tokenHash).not.toContain(result.refreshToken);
    expect(createArgs.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createArgs.data.expiresAt).toBeInstanceOf(Date);
    // ~30d in the future (default)
    const msUntilExpiry = createArgs.data.expiresAt.getTime() - Date.now();
    expect(msUntilExpiry).toBeGreaterThan(29 * 24 * 3600 * 1000);
    expect(msUntilExpiry).toBeLessThanOrEqual(30 * 24 * 3600 * 1000 + 1000);
  });

  // 2 — rotate happy path
  it('rotate() atomically claims old token, inserts new, links replacedBy, returns new pair', async () => {
    const oldPlain = 'plain-refresh-abc';
    const oldHash = sha256Hex(oldPlain);
    const oldRow = {
      id: 'old-id',
      userId: 'user-A',
      tokenHash: oldHash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedBy: null,
      user: { role: 'admin' },
    };
    tx.refreshToken.findUnique.mockResolvedValue(oldRow);
    tx.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    tx.refreshToken.create.mockImplementation(async ({ data }: any) => ({
      id: 'new-id',
      ...data,
    }));
    tx.refreshToken.update.mockImplementation(async ({ where, data }: any) => ({
      ...oldRow,
      ...data,
    }));

    const before = Date.now();
    const result = await service.rotate(oldPlain);
    const after = Date.now();

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken).not.toBe(oldPlain);
    expect(result.expiresIn).toBe(900);

    // Atomic claim: updateMany guarded on revokedAt: null
    expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    const claimArgs = tx.refreshToken.updateMany.mock.calls[0][0];
    expect(claimArgs.where).toEqual({ id: 'old-id', revokedAt: null });
    expect(claimArgs.data.revokedAt).toBeInstanceOf(Date);
    expect(claimArgs.data.revokedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(claimArgs.data.revokedAt.getTime()).toBeLessThanOrEqual(after);

    // old row final update: replacedBy linked (revokedAt already set by claim)
    expect(tx.refreshToken.update).toHaveBeenCalledTimes(1);
    const updateArgs = tx.refreshToken.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'old-id' });
    expect(updateArgs.data.replacedBy).toBe('new-id');

    // new row insert
    expect(tx.refreshToken.create).toHaveBeenCalledTimes(1);
    const createArgs = tx.refreshToken.create.mock.calls[0][0];
    expect(createArgs.data.userId).toBe('user-A');
    expect(createArgs.data.tokenHash).toBe(sha256Hex(result.refreshToken));

    // access token is signed with the user's role from the include
    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: 'user-A', role: 'admin' },
      { expiresIn: 900 },
    );

    // ran inside a transaction
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  // 3 — rotation detection
  it('rotate() on a revoked token throws and revokes all non-revoked tokens for that user', async () => {
    const plain = 'already-revoked';
    const hash = sha256Hex(plain);
    const revokedRow = {
      id: 'revoked-id',
      userId: 'user-A',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000), // not expired
      revokedAt: new Date(Date.now() - 1000), // already revoked
      replacedBy: 'some-newer-id',
    };
    tx.refreshToken.findUnique.mockResolvedValue(revokedRow);
    // Chain revocation happens via outer prisma (after the txn commits).
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

    const before = Date.now();
    await expect(service.rotate(plain)).rejects.toThrow('Refresh token reuse detected');
    const after = Date.now();

    // Chain revocation was issued OUTSIDE the txn — on the outer prisma
    // client, not the tx client. This is the bug-fix guarantee: the revoke
    // writes cannot be rolled back by the throw.
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    const args = prisma.refreshToken.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'user-A', revokedAt: null });
    expect(args.data.revokedAt).toBeInstanceOf(Date);
    expect(args.data.revokedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(args.data.revokedAt.getTime()).toBeLessThanOrEqual(after);

    // No tx writes happened on the reuse path — reuse is detected pre-claim.
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
    expect(tx.refreshToken.update).not.toHaveBeenCalled();
  });

  // 4 — expiry
  it('rotate() on an expired token throws UnauthorizedException', async () => {
    const plain = 'expired-one';
    const hash = sha256Hex(plain);
    tx.refreshToken.findUnique.mockResolvedValue({
      id: 'exp-id',
      userId: 'user-A',
      tokenHash: hash,
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      replacedBy: null,
    });

    await expect(service.rotate(plain)).rejects.toThrow('Refresh token expired');

    expect(tx.refreshToken.create).not.toHaveBeenCalled();
    expect(tx.refreshToken.update).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  // 5 — unknown
  it('rotate() on an unknown hash throws UnauthorizedException', async () => {
    tx.refreshToken.findUnique.mockResolvedValue(null);

    await expect(service.rotate('does-not-exist')).rejects.toThrow('Invalid refresh token');

    expect(tx.refreshToken.create).not.toHaveBeenCalled();
    expect(tx.refreshToken.update).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  // 5b — concurrency race: second rotation loses the atomic claim
  it('rotate() treats lost atomic-claim race as reuse: revokes chain and throws', async () => {
    const plain = 'contended-refresh';
    const hash = sha256Hex(plain);
    const row = {
      id: 'contended-id',
      userId: 'user-A',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedBy: null,
      user: { role: 'player' },
    };
    tx.refreshToken.findUnique.mockResolvedValue(row);

    // First rotate wins the claim; second rotate (simulated) loses it.
    tx.refreshToken.updateMany
      // 1st call: winner's atomic claim
      .mockResolvedValueOnce({ count: 1 })
      // 2nd call: loser's atomic claim — already revoked by winner
      .mockResolvedValueOnce({ count: 0 });
    tx.refreshToken.create.mockImplementation(async ({ data }: any) => ({
      id: 'new-id',
      ...data,
    }));
    tx.refreshToken.update.mockImplementation(async ({ where, data }: any) => ({
      ...row,
      ...data,
    }));
    // Loser's chain revocation happens outside the txn.
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    // Winner succeeds with a new pair.
    const winnerResult = await service.rotate(plain);
    expect(winnerResult.accessToken).toBe('signed.jwt.token');
    expect(winnerResult.refreshToken).not.toBe(plain);

    // Loser: claim.count === 0 → treat as reuse, revoke chain, throw.
    await expect(service.rotate(plain)).rejects.toThrow('Refresh token reuse detected');

    // Two tx.updateMany calls: winner-claim + loser-claim (both inside txn).
    expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(2);
    // Chain revocation happened OUTSIDE the txn on the outer prisma client.
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    const chainRevokeArgs = prisma.refreshToken.updateMany.mock.calls[0][0];
    expect(chainRevokeArgs.where).toEqual({ userId: 'user-A', revokedAt: null });
    expect(chainRevokeArgs.data.revokedAt).toBeInstanceOf(Date);

    // Only one new row was ever created (by the winner).
    expect(tx.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  // 5c — regression: txn throws don't undo reuse-chain revocation
  // When the txn callback throws (simulating real Prisma rollback semantics),
  // any writes that the old buggy code did inside the txn would be rolled
  // back. The fix moves chain revocation OUTSIDE the txn so a throw can't
  // undo it. This test wires up a strict rollback-simulating transaction
  // mock and verifies the outer updateMany fires AND tx writes are absent.
  it('rotate() reuse revocation is not rolled back when txn callback throws', async () => {
    const plain = 'already-revoked';
    const hash = sha256Hex(plain);
    const revokedRow = {
      id: 'revoked-id',
      userId: 'user-A',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(Date.now() - 1000),
      replacedBy: 'newer-id',
    };

    const txWrites: Array<{ op: string; args: unknown }> = [];
    const outerWrites: Array<{ op: string; args: unknown }> = [];

    const txClient: PrismaTxClient = {
      refreshToken: {
        findUnique: vi.fn().mockResolvedValue(revokedRow),
        create: vi.fn(async (args: unknown) => {
          txWrites.push({ op: 'create', args });
          return { id: 'x' };
        }),
        update: vi.fn(async (args: unknown) => {
          txWrites.push({ op: 'update', args });
          return {};
        }),
        updateMany: vi.fn(async (args: unknown) => {
          txWrites.push({ op: 'updateMany', args });
          return { count: 0 };
        }),
      },
    };

    const rollbackPrisma: any = {
      refreshToken: {
        updateMany: vi.fn(async (args: unknown) => {
          outerWrites.push({ op: 'updateMany', args });
          return { count: 2 };
        }),
      },
      // Simulate Prisma's rollback-on-throw behavior: if the callback throws,
      // discard writes recorded inside the callback.
      $transaction: vi.fn(async (cb: (client: PrismaTxClient) => Promise<unknown>) => {
        const snapshot = txWrites.length;
        try {
          return await cb(txClient);
        } catch (err) {
          txWrites.length = snapshot;
          throw err;
        }
      }),
    };

    const svc = new TokenService(rollbackPrisma, jwt as any, config as any);

    await expect(svc.rotate(plain)).rejects.toThrow('Refresh token reuse detected');

    // The outer updateMany for chain revocation MUST have fired.
    expect(outerWrites).toHaveLength(1);
    expect(outerWrites[0].op).toBe('updateMany');
    expect((outerWrites[0].args as any).where).toEqual({
      userId: 'user-A',
      revokedAt: null,
    });

    // And even if it had been inside the txn, the throw would roll it back
    // (txWrites would be empty here too). We assert no inside writes happened
    // to prove the reuse path short-circuits before touching the txn.
    expect(txWrites).toHaveLength(0);
  });

  // 6 — verifyAccess (valid)
  it('verifyAccess() returns payload on valid JWT', () => {
    jwt.verify.mockReturnValue({ sub: 'user-A', role: 'admin' });

    const result = service.verifyAccess('some.jwt.token');

    expect(result).toEqual({ userId: 'user-A', role: 'admin' });
    expect(jwt.verify).toHaveBeenCalledWith('some.jwt.token');
  });

  // 6b — verifyAccess (invalid)
  it('verifyAccess() throws UnauthorizedException on expired or malformed JWT', () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    expect(() => service.verifyAccess('bad.token')).toThrow(UnauthorizedException);
  });

  // 7 — logout
  it('revokeAll() revokes only non-revoked tokens for the given user', async () => {
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    const before = Date.now();
    await service.revokeAll('user-A');
    const after = Date.now();

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    const args = prisma.refreshToken.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'user-A', revokedAt: null });
    expect(args.data.revokedAt).toBeInstanceOf(Date);
    expect(args.data.revokedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(args.data.revokedAt.getTime()).toBeLessThanOrEqual(after);
  });

  // TTL parsing — verify custom config is honored
  describe('TTL parsing', () => {
    it('honors AUTH_ACCESS_TTL in seconds/minutes/hours/days', async () => {
      // '2h' -> 7200s
      config = makeConfig({ AUTH_ACCESS_TTL: '2h', AUTH_REFRESH_TTL: '7d' });
      service = new TokenService(prisma as any, jwt as any, config as any);
      prisma.refreshToken.create.mockImplementation(async ({ data }: any) => ({ id: 'x', ...data }));

      const result = await service.issue('user-A', 'player');

      expect(result.expiresIn).toBe(7200);
      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: 'user-A', role: 'player' },
        { expiresIn: 7200 },
      );

      const createArgs = prisma.refreshToken.create.mock.calls[0][0];
      const msUntilExpiry = createArgs.data.expiresAt.getTime() - Date.now();
      // ~7 days
      expect(msUntilExpiry).toBeGreaterThan(6 * 24 * 3600 * 1000);
      expect(msUntilExpiry).toBeLessThanOrEqual(7 * 24 * 3600 * 1000 + 1000);
    });

    it('supports seconds suffix (e.g. "45s")', async () => {
      config = makeConfig({ AUTH_ACCESS_TTL: '45s', AUTH_REFRESH_TTL: '60m' });
      service = new TokenService(prisma as any, jwt as any, config as any);
      prisma.refreshToken.create.mockImplementation(async ({ data }: any) => ({ id: 'x', ...data }));

      const result = await service.issue('user-A', 'player');

      expect(result.expiresIn).toBe(45);
    });
  });
});
