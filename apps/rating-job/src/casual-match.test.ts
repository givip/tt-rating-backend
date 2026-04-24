import { describe, it, expect, vi } from 'vitest';
import { processCasualMatch } from './index';

function mockPrisma(overrides: any = {}) {
  const match = {
    id: 'm-1',
    matchType: 'casual',
    status: 'confirmed',
    player1Id: 'p-1',
    player2Id: 'p-2',
    winnerId: 'p-1',
    matchWeight: 0.3,
    ...overrides.match,
  };
  const players: Record<string, any> = {
    'p-1': { id: 'p-1', internalRating: 1800, rd: 80 },
    'p-2': { id: 'p-2', internalRating: 1700, rd: 90 },
  };
  return {
    match: { findUnique: vi.fn().mockResolvedValue(match) },
    player: {
      findUnique: vi.fn(({ where: { id } }: any) => players[id]),
      update: vi.fn(),
    },
    ratingChange: { create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn({
      match: { findUnique: vi.fn().mockResolvedValue(match) },
      player: {
        findUnique: vi.fn(({ where: { id } }: any) => players[id]),
        update: vi.fn(),
      },
      ratingChange: { create: vi.fn() },
      $executeRaw: vi.fn(),
    })),
    $executeRaw: vi.fn(),
  } as any;
}

describe('processCasualMatch', () => {
  it('throws when match not found', async () => {
    const prisma = mockPrisma();
    prisma.match.findUnique.mockResolvedValue(null);
    prisma.$transaction = vi.fn(async (fn: any) =>
      fn({ match: { findUnique: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(processCasualMatch('m-missing', prisma)).rejects.toThrow(
      /not found/i,
    );
  });

  it('throws when match is not casual', async () => {
    const prisma = mockPrisma({ match: { matchType: 'tournament' } });
    prisma.$transaction = vi.fn(async (fn: any) =>
      fn({
        match: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'm-1', matchType: 'tournament', status: 'completed',
          }),
        },
      }),
    );
    await expect(processCasualMatch('m-1', prisma)).rejects.toThrow(/casual/i);
  });

  it('throws when match status != confirmed', async () => {
    const prisma = mockPrisma({ match: { status: 'pending_opponent' } });
    prisma.$transaction = vi.fn(async (fn: any) =>
      fn({
        match: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'm-1', matchType: 'casual', status: 'pending_opponent',
          }),
        },
      }),
    );
    await expect(processCasualMatch('m-1', prisma)).rejects.toThrow(/confirmed/i);
  });

  it('writes two RatingChange rows with tournamentId=null and updates both players', async () => {
    const ratingChangeCreate = vi.fn();
    const playerUpdate = vi.fn();
    const executeRaw = vi.fn();
    const match = {
      id: 'm-1', matchType: 'casual', status: 'confirmed',
      player1Id: 'p-1', player2Id: 'p-2', winnerId: 'p-1', matchWeight: 0.3,
    };
    const players: Record<string, any> = {
      'p-1': { id: 'p-1', internalRating: 1800, rd: 80 },
      'p-2': { id: 'p-2', internalRating: 1700, rd: 90 },
    };
    const prisma: any = {
      $transaction: vi.fn(async (fn: any) =>
        fn({
          match: { findUnique: vi.fn().mockResolvedValue(match) },
          player: {
            findUnique: vi.fn(({ where: { id } }: any) => players[id]),
            update: playerUpdate,
          },
          ratingChange: { create: ratingChangeCreate },
          $executeRaw: executeRaw,
        }),
      ),
      $executeRaw: vi.fn(),
    };

    await processCasualMatch('m-1', prisma);

    // Two RatingChange rows, both with tournamentId: null and changeType: 'manual' (or 'casual' once added)
    expect(ratingChangeCreate).toHaveBeenCalledTimes(2);
    const calls = ratingChangeCreate.mock.calls.map((c) => c[0].data);
    expect(calls.every((d: any) => d.tournamentId === null)).toBe(true);
    expect(calls.map((d: any) => d.playerId).sort()).toEqual(['p-1', 'p-2']);

    // Both players updated
    expect(playerUpdate).toHaveBeenCalledTimes(2);

    // Advisory lock acquired inside the transaction
    expect(executeRaw).toHaveBeenCalled();
    const lockCall = executeRaw.mock.calls.find((c) =>
      String(c[0]).includes('pg_advisory_xact_lock'),
    );
    expect(lockCall).toBeDefined();
  });
});
