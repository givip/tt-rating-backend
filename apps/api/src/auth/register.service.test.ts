import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { RegisterService } from './register.service';

function fakeNow(d: Date) {
  vi.useFakeTimers();
  vi.setSystemTime(d);
}

function makePrisma(overrides: any = {}) {
  return {
    invite: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => fn({
      invite: overrides.tx?.invite ?? { findUnique: vi.fn(), update: vi.fn() },
      user: overrides.tx?.user ?? { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    })),
    ...overrides,
  };
}

describe('RegisterService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('rejects when invite code not found', async () => {
    const prisma = makePrisma({
      $transaction: vi.fn(async (fn: any) =>
        fn({
          invite: { findUnique: vi.fn().mockResolvedValue(null) },
          user: { findFirst: vi.fn(), create: vi.fn() },
        }),
      ),
    });
    const tokens = { issue: vi.fn() } as never;
    const svc = new RegisterService(prisma as never, tokens, { hash: vi.fn() } as never);
    await expect(
      svc.register({
        identifier: 'a@b.c',
        credential: 'pw12345678',
        name: 'A',
        inviteCode: 'NOPE',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when invite expired', async () => {
    fakeNow(new Date('2026-04-26T12:00:00Z'));
    const prisma = makePrisma({
      $transaction: vi.fn(async (fn: any) =>
        fn({
          invite: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'i1',
              code: 'GOOD',
              role: 'player',
              expiresAt: new Date('2026-04-25T12:00:00Z'),
              usedAt: null,
            }),
            update: vi.fn(),
          },
          user: { findFirst: vi.fn(), create: vi.fn() },
        }),
      ),
    });
    const svc = new RegisterService(prisma as never, { issue: vi.fn() } as never, { hash: vi.fn() } as never);
    await expect(
      svc.register({
        identifier: 'a@b.c',
        credential: 'pw12345678',
        name: 'A',
        inviteCode: 'GOOD',
      }),
    ).rejects.toThrow(/expired/i);
  });

  it('rejects when invite already used', async () => {
    fakeNow(new Date('2026-04-26T12:00:00Z'));
    const prisma = makePrisma({
      $transaction: vi.fn(async (fn: any) =>
        fn({
          invite: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'i1',
              code: 'GOOD',
              role: 'player',
              expiresAt: new Date('2026-05-01T12:00:00Z'),
              usedAt: new Date('2026-04-25T12:00:00Z'),
            }),
            update: vi.fn(),
          },
          user: { findFirst: vi.fn(), create: vi.fn() },
        }),
      ),
    });
    const svc = new RegisterService(prisma as never, { issue: vi.fn() } as never, { hash: vi.fn() } as never);
    await expect(
      svc.register({
        identifier: 'a@b.c',
        credential: 'pw12345678',
        name: 'A',
        inviteCode: 'GOOD',
      }),
    ).rejects.toThrow(/already used/i);
  });

  it('rejects when identifier already registered', async () => {
    fakeNow(new Date('2026-04-26T12:00:00Z'));
    const prisma = makePrisma({
      $transaction: vi.fn(async (fn: any) =>
        fn({
          invite: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'i1',
              code: 'GOOD',
              role: 'player',
              expiresAt: new Date('2026-05-01T12:00:00Z'),
              usedAt: null,
            }),
            update: vi.fn(),
          },
          user: {
            findFirst: vi.fn().mockResolvedValue({ id: 'taken' }),
            create: vi.fn(),
          },
        }),
      ),
    });
    const svc = new RegisterService(prisma as never, { issue: vi.fn() } as never, { hash: vi.fn() } as never);
    await expect(
      svc.register({
        identifier: 'a@b.c',
        credential: 'pw12345678',
        name: 'A',
        inviteCode: 'GOOD',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates user, marks invite used, and issues tokens', async () => {
    fakeNow(new Date('2026-04-26T12:00:00Z'));
    const inviteUpdate = vi.fn();
    const userCreate = vi.fn().mockResolvedValue({ id: 'new-user-id', role: 'organizer' });
    const prisma = makePrisma({
      $transaction: vi.fn(async (fn: any) =>
        fn({
          invite: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'i1',
              code: 'GOOD',
              role: 'organizer',
              expiresAt: new Date('2026-05-01T12:00:00Z'),
              usedAt: null,
            }),
            update: inviteUpdate,
          },
          user: { findFirst: vi.fn().mockResolvedValue(null), create: userCreate },
        }),
      ),
    });
    const issue = vi.fn().mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 900,
    });
    const hash = vi.fn().mockResolvedValue('hashed');
    const svc = new RegisterService(prisma as never, { issue } as never, { hash } as never);

    const out = await svc.register({
      identifier: 'a@b.c',
      credential: 'pw12345678',
      name: 'A',
      inviteCode: 'GOOD',
    });

    expect(hash).toHaveBeenCalledWith('pw12345678');
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'a@b.c',
          phone: null,
          passwordHash: 'hashed',
          role: 'organizer',
        }),
      }),
    );
    expect(inviteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1' },
        data: expect.objectContaining({ usedAt: expect.any(Date), usedBy: 'new-user-id' }),
      }),
    );
    expect(issue).toHaveBeenCalledWith('new-user-id', 'organizer');
    expect(out.tokens).toEqual({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
  });

  it('routes phone-shaped identifiers into the phone column', async () => {
    fakeNow(new Date('2026-04-26T12:00:00Z'));
    const userCreate = vi.fn().mockResolvedValue({ id: 'u', role: 'player' });
    const prisma = makePrisma({
      $transaction: vi.fn(async (fn: any) =>
        fn({
          invite: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'i1',
              code: 'GOOD',
              role: 'player',
              expiresAt: new Date('2026-05-01T12:00:00Z'),
              usedAt: null,
            }),
            update: vi.fn(),
          },
          user: { findFirst: vi.fn().mockResolvedValue(null), create: userCreate },
        }),
      ),
    });
    const svc = new RegisterService(
      prisma as never,
      { issue: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 1 }) } as never,
      { hash: vi.fn().mockResolvedValue('h') } as never,
    );

    await svc.register({
      identifier: '+995591234567',
      credential: 'pw12345678',
      name: 'A',
      inviteCode: 'GOOD',
    });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: null, phone: '+995591234567' }),
      }),
    );
  });
});
