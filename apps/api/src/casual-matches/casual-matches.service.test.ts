import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CasualMatchesService } from './casual-matches.service';

const mockPrisma: any = {
  player: { findUnique: vi.fn() },
  match: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
  ratingConfig: { findUnique: vi.fn() },
};
const mockTrigger = { trigger: vi.fn() };

function newService() {
  return new CasualMatchesService(mockPrisma, mockTrigger as any);
}

beforeEach(() => {
  for (const fn of [
    mockPrisma.player.findUnique,
    mockPrisma.match.create,
    mockPrisma.match.findUnique,
    mockPrisma.match.findMany,
    mockPrisma.match.update,
    mockPrisma.match.delete,
    mockPrisma.ratingConfig.findUnique,
    mockTrigger.trigger,
  ]) fn.mockReset();
});

describe('CasualMatchesService.propose', () => {
  const proposer = { userId: 'u-alice', role: 'player' };
  const base = {
    opponentId: 'p-bob',
    winnerId: 'p-alice',
    setsPlayer1: 3,
    setsPlayer2: 1,
  };

  it('throws when proposer is the same as opponent', async () => {
    mockPrisma.player.findUnique.mockImplementation(({ where: { userId } }: any) =>
      userId === 'u-alice' ? { id: 'p-alice', tournamentsPlayed: 10 } : null,
    );
    await expect(
      newService().propose({ ...base, opponentId: 'p-alice' }, proposer),
    ).rejects.toThrow(/same player/i);
  });

  it('throws when proposer is provisional (< 5 tournaments)', async () => {
    mockPrisma.player.findUnique.mockImplementation(({ where }: any) => {
      if (where.userId === 'u-alice') return { id: 'p-alice', tournamentsPlayed: 2 };
      if (where.id === 'p-bob') return { id: 'p-bob', tournamentsPlayed: 30 };
      return null;
    });
    await expect(newService().propose(base, proposer)).rejects.toThrow(/provisional/i);
  });

  it('throws when opponent not found', async () => {
    mockPrisma.player.findUnique.mockImplementation(({ where }: any) => {
      if (where.userId === 'u-alice') return { id: 'p-alice', tournamentsPlayed: 10 };
      return null;
    });
    await expect(newService().propose(base, proposer)).rejects.toThrow(/opponent/i);
  });

  it('throws when winnerId is not one of the two players', async () => {
    mockPrisma.player.findUnique.mockImplementation(({ where }: any) => {
      if (where.userId === 'u-alice') return { id: 'p-alice', tournamentsPlayed: 10 };
      if (where.id === 'p-bob') return { id: 'p-bob', tournamentsPlayed: 30 };
      return null;
    });
    await expect(
      newService().propose({ ...base, winnerId: 'p-nobody' }, proposer),
    ).rejects.toThrow(/winner/i);
  });

  it("throws when winner's set count is not greater than loser's", async () => {
    mockPrisma.player.findUnique.mockImplementation(({ where }: any) => {
      if (where.userId === 'u-alice') return { id: 'p-alice', tournamentsPlayed: 10 };
      if (where.id === 'p-bob') return { id: 'p-bob', tournamentsPlayed: 30 };
      return null;
    });
    await expect(
      newService().propose({ ...base, setsPlayer1: 1, setsPlayer2: 3 }, proposer),
    ).rejects.toThrow(/winner/i);
  });

  it('creates match with matchWeight = bo5-weight × casual multiplier', async () => {
    mockPrisma.player.findUnique.mockImplementation(({ where }: any) => {
      if (where.userId === 'u-alice') return { id: 'p-alice', tournamentsPlayed: 10 };
      if (where.id === 'p-bob') return { id: 'p-bob', tournamentsPlayed: 30 };
      return null;
    });
    mockPrisma.ratingConfig.findUnique.mockResolvedValue({
      key: 'casual_weight_multiplier', value: 0.3,
    });
    mockPrisma.match.create.mockResolvedValue({ id: 'm-1' });

    await newService().propose(base, proposer);

    const data = mockPrisma.match.create.mock.calls[0][0].data;
    // bo5 3:1 weight = 0.9 → casual = 0.9 * 0.3 = 0.27
    expect(data.matchWeight).toBeCloseTo(0.27, 5);
    expect(data.matchType).toBe('casual');
    expect(data.status).toBe('pending_opponent');
    expect(data.player1Id).toBe('p-alice');
    expect(data.player2Id).toBe('p-bob');
    expect(data.proposerId).toBe('p-alice');
    expect(data.tournamentId).toBeNull();
    expect(data.round).toBe(1);
    expect(data.expiresAt).toBeInstanceOf(Date);
    const ms = data.expiresAt.getTime() - Date.now();
    expect(ms).toBeGreaterThan(6 * 24 * 3600 * 1000); // ~7 days
    expect(ms).toBeLessThan(8 * 24 * 3600 * 1000);
  });

  it('falls back to default multiplier 0.3 if RatingConfig key missing', async () => {
    mockPrisma.player.findUnique.mockImplementation(({ where }: any) => {
      if (where.userId === 'u-alice') return { id: 'p-alice', tournamentsPlayed: 10 };
      if (where.id === 'p-bob') return { id: 'p-bob', tournamentsPlayed: 30 };
      return null;
    });
    mockPrisma.ratingConfig.findUnique.mockResolvedValue(null);
    mockPrisma.match.create.mockResolvedValue({ id: 'm-1' });

    await newService().propose(base, proposer);
    const data = mockPrisma.match.create.mock.calls[0][0].data;
    expect(data.matchWeight).toBeCloseTo(0.27, 5);
  });
});
