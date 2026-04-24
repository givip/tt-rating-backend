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

  it('rejects bo5 scores outside {3:0, 3:1, 3:2}', async () => {
    mockPrisma.player.findUnique.mockImplementation(({ where }: any) => {
      if (where.userId === 'u-alice') return { id: 'p-alice', tournamentsPlayed: 10 };
      if (where.id === 'p-bob') return { id: 'p-bob', tournamentsPlayed: 30 };
      return null;
    });
    mockPrisma.ratingConfig.findUnique.mockResolvedValue({
      key: 'casual_weight_multiplier', value: 0.3,
    });
    // 4:1 is winner>loser but not a bo5 terminal score
    await expect(
      newService().propose({ ...base, setsPlayer1: 4, setsPlayer2: 1 }, proposer),
    ).rejects.toThrow(/invalid bo5 score/i);
  });

  it('falls back to default multiplier 0.3 when RatingConfig value is non-numeric', async () => {
    mockPrisma.player.findUnique.mockImplementation(({ where }: any) => {
      if (where.userId === 'u-alice') return { id: 'p-alice', tournamentsPlayed: 10 };
      if (where.id === 'p-bob') return { id: 'p-bob', tournamentsPlayed: 30 };
      return null;
    });
    mockPrisma.ratingConfig.findUnique.mockResolvedValue({
      key: 'casual_weight_multiplier', value: 'not-a-number',
    });
    mockPrisma.match.create.mockResolvedValue({ id: 'm-1' });
    await newService().propose(base, proposer);
    const data = mockPrisma.match.create.mock.calls[0][0].data;
    // bo5 3:1 × default 0.3 = 0.27
    expect(data.matchWeight).toBeCloseTo(0.27, 5);
  });
});

describe('CasualMatchesService.accept', () => {
  const bob = { userId: 'u-bob', role: 'player' };
  const baseMatch = {
    id: 'm-1',
    matchType: 'casual',
    status: 'pending_opponent',
    player1Id: 'p-alice',
    player2Id: 'p-bob',
    proposerId: 'p-alice',
    expiresAt: new Date(Date.now() + 86400 * 1000),
  };

  it('throws when match not found', async () => {
    mockPrisma.match.findUnique.mockResolvedValue(null);
    await expect(newService().accept('m-missing', bob)).rejects.toThrow(/not found/i);
  });

  it('throws when caller is not player2 (the opponent)', async () => {
    mockPrisma.match.findUnique.mockResolvedValue(baseMatch);
    mockPrisma.player.findUnique.mockResolvedValue({ id: 'p-someoneelse', userId: 'u-bob' });
    await expect(newService().accept('m-1', bob)).rejects.toThrow(/forbidden|opponent/i);
  });

  it('throws when status is not pending_opponent', async () => {
    mockPrisma.match.findUnique.mockResolvedValue({ ...baseMatch, status: 'confirmed' });
    mockPrisma.player.findUnique.mockResolvedValue({ id: 'p-bob', userId: 'u-bob' });
    await expect(newService().accept('m-1', bob)).rejects.toThrow(/pending|status/i);
  });

  it('throws when expiresAt is in the past', async () => {
    mockPrisma.match.findUnique.mockResolvedValue({
      ...baseMatch,
      expiresAt: new Date(Date.now() - 1000),
    });
    mockPrisma.player.findUnique.mockResolvedValue({ id: 'p-bob', userId: 'u-bob' });
    await expect(newService().accept('m-1', bob)).rejects.toThrow(/expired/i);
  });

  it('flips to confirmed, stamps confirmedAt, calls trigger({ matchId })', async () => {
    mockPrisma.match.findUnique.mockResolvedValue(baseMatch);
    mockPrisma.player.findUnique.mockResolvedValue({ id: 'p-bob', userId: 'u-bob' });
    mockPrisma.match.update.mockResolvedValue({ ...baseMatch, status: 'confirmed' });

    await newService().accept('m-1', bob);

    const updateCall = mockPrisma.match.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'm-1' });
    expect(updateCall.data.status).toBe('confirmed');
    expect(updateCall.data.confirmedAt).toBeInstanceOf(Date);
    expect(mockTrigger.trigger).toHaveBeenCalledWith({ matchId: 'm-1' });
  });
});

describe('CasualMatchesService.reject', () => {
  it('forbids non-opponent callers', async () => {
    mockPrisma.match.findUnique.mockResolvedValue({
      id: 'm-1', matchType: 'casual', status: 'pending_opponent',
      player1Id: 'p-alice', player2Id: 'p-bob',
    });
    mockPrisma.player.findUnique.mockResolvedValue({ id: 'p-someoneelse', userId: 'u-carol' });
    await expect(
      newService().reject('m-1', { userId: 'u-carol', role: 'player' }),
    ).rejects.toThrow(/forbidden|opponent/i);
  });

  it('flips to rejected; does NOT call trigger', async () => {
    mockPrisma.match.findUnique.mockResolvedValue({
      id: 'm-1', matchType: 'casual', status: 'pending_opponent',
      player1Id: 'p-alice', player2Id: 'p-bob',
    });
    mockPrisma.player.findUnique.mockResolvedValue({ id: 'p-bob', userId: 'u-bob' });
    mockPrisma.match.update.mockResolvedValue({});

    await newService().reject('m-1', { userId: 'u-bob', role: 'player' });

    expect(mockPrisma.match.update.mock.calls[0][0].data.status).toBe('rejected');
    expect(mockTrigger.trigger).not.toHaveBeenCalled();
  });
});

describe('CasualMatchesService.cancel', () => {
  it('forbids non-proposer callers', async () => {
    mockPrisma.match.findUnique.mockResolvedValue({
      id: 'm-1', matchType: 'casual', status: 'pending_opponent',
      player1Id: 'p-alice', player2Id: 'p-bob', proposerId: 'p-alice',
    });
    mockPrisma.player.findUnique.mockResolvedValue({ id: 'p-bob', userId: 'u-bob' });
    await expect(
      newService().cancel('m-1', { userId: 'u-bob', role: 'player' }),
    ).rejects.toThrow(/forbidden|proposer/i);
  });

  it('forbids cancel once status != pending_opponent', async () => {
    mockPrisma.match.findUnique.mockResolvedValue({
      id: 'm-1', matchType: 'casual', status: 'confirmed',
      player1Id: 'p-alice', proposerId: 'p-alice',
    });
    mockPrisma.player.findUnique.mockResolvedValue({ id: 'p-alice', userId: 'u-alice' });
    await expect(
      newService().cancel('m-1', { userId: 'u-alice', role: 'player' }),
    ).rejects.toThrow(/pending|status/i);
  });

  it('hard-deletes when proposer cancels pending match', async () => {
    mockPrisma.match.findUnique.mockResolvedValue({
      id: 'm-1', matchType: 'casual', status: 'pending_opponent',
      player1Id: 'p-alice', proposerId: 'p-alice',
    });
    mockPrisma.player.findUnique.mockResolvedValue({ id: 'p-alice', userId: 'u-alice' });
    mockPrisma.match.delete.mockResolvedValue({});

    await newService().cancel('m-1', { userId: 'u-alice', role: 'player' });

    expect(mockPrisma.match.delete).toHaveBeenCalledWith({ where: { id: 'm-1' } });
  });
});
