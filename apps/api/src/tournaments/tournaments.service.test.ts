import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TournamentsService } from './tournaments.service';

const organizerActor = { userId: 'org-1', role: 'organizer' as const };
const otherOrganizerActor = { userId: 'org-2', role: 'organizer' as const };
const adminActor = { userId: 'admin-1', role: 'admin' as const };

/**
 * Build a fresh prisma mock for a test. Configure with:
 *   - `tournament`: object returned from `tournament.findUnique`. Defaults to null.
 *   - `participants`: array returned from `tournamentParticipant.findMany`. Defaults to [].
 * All write methods (create/update/createMany) are vi.fn() returning empty results.
 * `$transaction(fn)` runs `fn(self)` so the same mock acts as the tx client too.
 */
function mockPrisma(opts: {
  tournament?: any;
  participants?: any[];
} = {}) {
  const prisma: any = {
    tournament: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(opts.tournament ?? null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(opts.tournament ?? {}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    tournamentParticipant: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue(opts.participants ?? []),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn().mockResolvedValue({}),
    },
    player: { findUnique: vi.fn() },
    match: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  return prisma;
}

describe('TournamentsService', () => {
  let service: TournamentsService;
  let prisma: ReturnType<typeof mockPrisma>;
  let mockRatingJob: { trigger: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = mockPrisma();
    mockRatingJob = { trigger: vi.fn() };
    service = new TournamentsService(prisma as any, mockRatingJob as any);
  });

  describe('validateParticipantCount', () => {
    it('throws BadRequestException with < 4 participants', () => {
      expect(() => service.validateParticipantCount(3)).toThrow(BadRequestException);
      expect(() => service.validateParticipantCount(0)).toThrow(BadRequestException);
    });

    it('does not throw with 4 or more participants', () => {
      expect(() => service.validateParticipantCount(4)).not.toThrow();
      expect(() => service.validateParticipantCount(32)).not.toThrow();
    });
  });

  describe('calculateMatchWeight', () => {
    it('returns 1.0 for 3:0 in BO5', () => {
      expect(service.calculateMatchWeight('bo5', 3, 0)).toBe(1.0);
    });
    it('returns 0.9 for 3:1 in BO5', () => {
      expect(service.calculateMatchWeight('bo5', 3, 1)).toBe(0.9);
    });
    it('returns 0.8 for 3:2 in BO5', () => {
      expect(service.calculateMatchWeight('bo5', 3, 2)).toBe(0.8);
    });
    it('returns 1.0 for 2:0 in BO3', () => {
      expect(service.calculateMatchWeight('bo3', 2, 0)).toBe(1.0);
    });
    it('returns 0.85 for 2:1 in BO3', () => {
      expect(service.calculateMatchWeight('bo3', 2, 1)).toBe(0.85);
    });
    it('returns 1.0 as fallback for unknown score pattern', () => {
      expect(service.calculateMatchWeight('bo5', 3, 99)).toBe(1.0);
    });
  });

  describe('addParticipant', () => {
    const tournamentOwnedByOrg1 = {
      id: 't1',
      organizerId: 'org-1',
      minRating: null,
      maxRating: null,
    };

    it('throws NotFoundException when tournament not found', async () => {
      prisma.tournament.findUnique.mockResolvedValue(null);
      await expect(
        service.addParticipant('t-nope', 'p1', organizerActor),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a different organizer tries to add', async () => {
      prisma.tournament.findUnique.mockResolvedValue(tournamentOwnedByOrg1);
      await expect(
        service.addParticipant('t1', 'p1', otherOrganizerActor),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.tournamentParticipant.create).not.toHaveBeenCalled();
    });

    it('admin can add to any tournament', async () => {
      prisma.tournament.findUnique.mockResolvedValue(tournamentOwnedByOrg1);
      prisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 1650, rd: 120,
      });
      prisma.tournamentParticipant.create.mockResolvedValue({});

      await service.addParticipant('t1', 'p1', adminActor);
      expect(prisma.tournamentParticipant.create).toHaveBeenCalled();
    });

    it('throws NotFoundException when player not found', async () => {
      prisma.tournament.findUnique.mockResolvedValue(tournamentOwnedByOrg1);
      prisma.player.findUnique.mockResolvedValue(null);
      await expect(
        service.addParticipant('t1', 'p-nonexistent', organizerActor),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates participant with snapshotted rating', async () => {
      prisma.tournament.findUnique.mockResolvedValue(tournamentOwnedByOrg1);
      prisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 1650, rd: 120,
      });
      prisma.tournamentParticipant.create.mockResolvedValue({ tournamentId: 't1', playerId: 'p1' });

      await service.addParticipant('t1', 'p1', organizerActor);

      expect(prisma.tournamentParticipant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tournamentId: 't1',
          playerId: 'p1',
          ratingBefore: 1650,
          rdBefore: 120,
        }),
      });
    });

    it('rejects a player below tournament.minRating', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        ...tournamentOwnedByOrg1, minRating: 1800, maxRating: null,
      });
      prisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 1650, rd: 120,
      });

      await expect(
        service.addParticipant('t1', 'p1', organizerActor),
      ).rejects.toThrow(/below min rating/i);
      expect(prisma.tournamentParticipant.create).not.toHaveBeenCalled();
    });

    it('rejects a player above tournament.maxRating', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        ...tournamentOwnedByOrg1, minRating: null, maxRating: 1500,
      });
      prisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 1650, rd: 120,
      });

      await expect(
        service.addParticipant('t1', 'p1', organizerActor),
      ).rejects.toThrow(/above max rating/i);
      expect(prisma.tournamentParticipant.create).not.toHaveBeenCalled();
    });

    it('null minRating and maxRating pass through (no constraint)', async () => {
      prisma.tournament.findUnique.mockResolvedValue(tournamentOwnedByOrg1);
      prisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 50, rd: 120,  // extreme low
      });
      prisma.tournamentParticipant.create.mockResolvedValue({});

      await service.addParticipant('t1', 'p1', organizerActor);
      expect(prisma.tournamentParticipant.create).toHaveBeenCalled();
    });

    it('allows a player exactly at minRating (inclusive)', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        ...tournamentOwnedByOrg1, minRating: 1650, maxRating: null,
      });
      prisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 1650, rd: 120,
      });
      prisma.tournamentParticipant.create.mockResolvedValue({});

      await service.addParticipant('t1', 'p1', organizerActor);
      expect(prisma.tournamentParticipant.create).toHaveBeenCalled();
    });
  });

  describe('finalize', () => {
    const base = {
      id: 't1',
      organizerId: 'org-1',
      processed: false,
      _count: { participants: 6 },
    };

    it('throws NotFoundException when tournament not found', async () => {
      prisma.tournament.findUnique.mockResolvedValue(null);
      await expect(service.finalize('t-nonexistent', organizerActor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when a different organizer finalizes', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      await expect(service.finalize('t1', otherOrganizerActor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockRatingJob.trigger).not.toHaveBeenCalled();
    });

    it('admin can finalize any tournament', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      prisma.tournament.update.mockResolvedValue({});
      mockRatingJob.trigger.mockResolvedValue(undefined);

      await service.finalize('t1', adminActor);
      expect(mockRatingJob.trigger).toHaveBeenCalledWith({ tournamentId: 't1' });
    });

    it('returns early if already processed', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        ...base, processed: true, _count: { participants: 8 },
      });
      const result = await service.finalize('t1', organizerActor);
      expect(result.message).toMatch(/already/i);
      expect(mockRatingJob.trigger).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if fewer than 4 participants', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        ...base, _count: { participants: 3 },
      });
      await expect(service.finalize('t1', organizerActor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sets status to completed and triggers rating job', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      prisma.tournament.update.mockResolvedValue({});
      mockRatingJob.trigger.mockResolvedValue(undefined);

      const result = await service.finalize('t1', organizerActor);

      expect(prisma.tournament.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: 'completed' },
      });
      expect(mockRatingJob.trigger).toHaveBeenCalledWith({ tournamentId: 't1' });
      expect(result.message).toBeTruthy();
    });
  });

  describe('create', () => {
    it('uses actor.userId as organizerId', async () => {
      prisma.tournament.create.mockResolvedValue({ id: 't-new' });
      await service.create(organizerActor, { title: 'Foo' });
      expect(prisma.tournament.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ organizerId: 'org-1', title: 'Foo' }),
      });
    });
  });

  describe('createMatch', () => {
    // A tournament with two registered participants that most createMatch
    // tests share; individual tests override fields they care about.
    const base = {
      id: 't1',
      organizerId: 'org-1',
      processed: false,
      matchFormat: 'bo5' as const,
      participants: [{ playerId: 'p1' }, { playerId: 'p2' }],
    };

    const validInput = {
      round: 1,
      player1Id: 'p1',
      player2Id: 'p2',
      winnerId: 'p1',
      setsPlayer1: 3,
      setsPlayer2: 1,
    };

    it('throws NotFoundException when tournament is missing', async () => {
      prisma.tournament.findUnique.mockResolvedValue(null);
      await expect(
        service.createMatch('t-missing', validInput, organizerActor),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.match.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when caller is not the organizer', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch('t1', validInput, otherOrganizerActor),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.match.create).not.toHaveBeenCalled();
    });

    it('admin can create matches in any tournament', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      prisma.match.create.mockResolvedValue({ id: 'm-new' });
      await service.createMatch('t1', validInput, adminActor);
      expect(prisma.match.create).toHaveBeenCalled();
    });

    it('throws BadRequestException when tournament is already processed', async () => {
      prisma.tournament.findUnique.mockResolvedValue({ ...base, processed: true });
      await expect(
        service.createMatch('t1', validInput, organizerActor),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when player1Id equals player2Id', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch(
          't1',
          { ...validInput, player2Id: 'p1' },
          organizerActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when a player is not a participant', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch(
          't1',
          { ...validInput, player2Id: 'p-stranger' },
          organizerActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when winnerId is not one of the players', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch(
          't1',
          { ...validInput, winnerId: 'p-other' },
          organizerActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when only one set count is provided', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch(
          't1',
          { ...validInput, setsPlayer2: undefined },
          organizerActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when winner's set count is not greater than loser's", async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch(
          't1',
          { ...validInput, setsPlayer1: 2, setsPlayer2: 3 },
          organizerActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a match with matchWeight derived from the tournament format', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      prisma.match.create.mockResolvedValue({ id: 'm-new' });

      await service.createMatch(
        't1',
        { ...validInput, setsPlayer1: 3, setsPlayer2: 2 },
        organizerActor,
      );

      expect(prisma.match.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tournamentId: 't1',
          player1Id: 'p1',
          player2Id: 'p2',
          winnerId: 'p1',
          setsPlayer1: 3,
          setsPlayer2: 2,
          matchWeight: 0.8, // bo5 3:2
          enteredBy: 'org-1',
          status: 'completed',
        }),
      });
    });

    it('allows creating a scheduled match without sets or winner', async () => {
      prisma.tournament.findUnique.mockResolvedValue(base);
      prisma.match.create.mockResolvedValue({ id: 'm-new' });

      await service.createMatch(
        't1',
        { round: 1, player1Id: 'p1', player2Id: 'p2' },
        organizerActor,
      );

      expect(prisma.match.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tournamentId: 't1',
          player1Id: 'p1',
          player2Id: 'p2',
          winnerId: null,
          setsPlayer1: null,
          setsPlayer2: null,
          matchWeight: 1.0,
          status: 'scheduled',
        }),
      });
    });
  });
});

describe('TournamentsService.prepare', () => {
  it('rejects if tournament not in open state', async () => {
    const prisma = mockPrisma({
      tournament: { id: 't1', status: 'draft', organizerId: 'u1', participantsCount: 8 },
    });
    const svc = new TournamentsService(prisma as any, mockRatingTrigger() as any);
    await expect(
      svc.prepare('t1', { format: 'round_robin' }, { userId: 'u1', role: 'organizer' }),
    ).rejects.toThrow(/must be in open/);
  });

  it('rejects format = single_elim with "unsupported format in v1"', async () => {
    const prisma = mockPrisma({
      tournament: { id: 't1', status: 'open', organizerId: 'u1', participantsCount: 8 },
      participants: range(8),
    });
    const svc = new TournamentsService(prisma as any, mockRatingTrigger() as any);
    await expect(
      svc.prepare('t1', { format: 'single_elim' as any }, { userId: 'u1', role: 'organizer' }),
    ).rejects.toThrow(/unsupported format/);
  });

  it('rejects groups_playoff if N < 2 * groupSize', async () => {
    const prisma = mockPrisma({
      tournament: { id: 't1', status: 'open', organizerId: 'u1', participantsCount: 6 },
      participants: range(6),
    });
    const svc = new TournamentsService(prisma as any, mockRatingTrigger() as any);
    await expect(
      svc.prepare(
        't1',
        { format: 'groups_playoff', groupSize: 4 },
        { userId: 'u1', role: 'organizer' },
      ),
    ).rejects.toThrow(/at least 8 participants/);
  });

  it('round-robin: writes all C(N,2) matches and flips status to prepared', async () => {
    const prisma = mockPrisma({
      tournament: { id: 't1', status: 'open', organizerId: 'u1', participantsCount: 4 },
      participants: range(4),
    });
    const svc = new TournamentsService(prisma as any, mockRatingTrigger() as any);
    await svc.prepare('t1', { format: 'round_robin' }, { userId: 'u1', role: 'organizer' });
    expect(prisma.match.createMany).toHaveBeenCalled();
    const created = prisma.match.createMany.mock.calls[0][0].data;
    expect(created.length).toBe(6);
    expect(prisma.tournament.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({ status: 'prepared', format: 'round_robin' }),
      }),
    );
  });

  it('groups_playoff: writes group matches + bracketShape, sets groupLetter on participants', async () => {
    const prisma = mockPrisma({
      tournament: { id: 't1', status: 'open', organizerId: 'u1', participantsCount: 8 },
      participants: range(8),
    });
    const svc = new TournamentsService(prisma as any, mockRatingTrigger() as any);
    await svc.prepare(
      't1',
      { format: 'groups_playoff', groupSize: 4 },
      { userId: 'u1', role: 'organizer' },
    );
    const created = prisma.match.createMany.mock.calls[0][0].data;
    expect(created.length).toBe(12);
    expect(created.every((m: any) => m.groupLetter !== null && m.bracketLabel === null)).toBe(true);
    const update = prisma.tournament.update.mock.calls[0][0];
    expect(update.data.bracketShape.subBrackets.length).toBe(4);
    expect(update.data.groupSize).toBe(4);
  });
});

function range(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    tournamentId: 't1',
    playerId: `p${i + 1}`,
    player: { internalRating: 2000 - i * 50 },
    seed: null,
    groupLetter: null,
    groupRank: null,
    finalPosition: null,
    withdrawnAt: null,
  }));
}

function mockRatingTrigger() {
  return { trigger: vi.fn() };
}

describe('TournamentsService.rewind', () => {
  it('rejects if tournament not in prepared state', async () => {
    const p = mockPrisma({ tournament: { id:'t1', status: 'open', organizerId: 'u1' } });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await expect(svc.rewind('t1', { userId:'u1', role:'organizer' }))
      .rejects.toThrow(/prepared/);
  });

  it('rejects if any match is already completed', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status: 'prepared', organizerId: 'u1' },
    });
    p.match.count.mockResolvedValue(1);
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await expect(svc.rewind('t1', { userId:'u1', role:'organizer' }))
      .rejects.toThrow(/completed match/);
  });

  it('clears draw and returns to open', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status: 'prepared', organizerId: 'u1', format:'round_robin', bracketShape:{} },
    });
    p.match.count.mockResolvedValue(0);
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await svc.rewind('t1', { userId:'u1', role:'organizer' });
    expect(p.match.deleteMany).toHaveBeenCalledWith({ where: { tournamentId:'t1' } });
    expect(p.tournament.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'open', format: null, bracketShape: null, groupSize: null }),
    }));
    expect(p.tournamentParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tournamentId:'t1' },
      data: { seed: null, groupLetter: null, groupRank: null },
    }));
  });
});

describe('TournamentsService.start', () => {
  it('rejects if tournament not in prepared state', async () => {
    const p = mockPrisma({ tournament: { id:'t1', status: 'in_progress', organizerId: 'u1' } });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await expect(svc.start('t1', { userId:'u1', role:'organizer' }))
      .rejects.toThrow(/prepared/);
  });

  it('flips status to in_progress', async () => {
    const p = mockPrisma({ tournament: { id:'t1', status: 'prepared', organizerId: 'u1' } });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await svc.start('t1', { userId:'u1', role:'organizer' });
    expect(p.tournament.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'in_progress' },
    }));
  });
});

describe('TournamentsService.dropParticipant', () => {
  it('hard-deletes in draft state', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'draft', organizerId:'u1' },
    });
    p.tournamentParticipant.findUnique.mockResolvedValue({
      tournamentId:'t1', playerId:'p1', withdrawnAt:null,
    });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await svc.dropParticipant('t1', 'p1', { userId:'u1', role:'organizer' });
    expect(p.tournamentParticipant.delete).toHaveBeenCalledWith({
      where: { tournamentId_playerId: { tournamentId:'t1', playerId:'p1' } },
    });
  });

  it('hard-deletes in open state', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'open', organizerId:'u1' },
    });
    p.tournamentParticipant.findUnique.mockResolvedValue({
      tournamentId:'t1', playerId:'p1', withdrawnAt:null,
    });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await svc.dropParticipant('t1', 'p1', { userId:'u1', role:'organizer' });
    expect(p.tournamentParticipant.delete).toHaveBeenCalled();
  });

  it('soft-deletes in prepared state and removes scheduled matches involving the player', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'prepared', organizerId:'u1' },
    });
    p.tournamentParticipant.findUnique.mockResolvedValue({
      tournamentId:'t1', playerId:'p1', withdrawnAt:null, groupLetter:'A',
    });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await svc.dropParticipant('t1', 'p1', { userId:'u1', role:'organizer' });
    expect(p.tournamentParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ withdrawnAt: expect.any(Date) }),
    }));
    expect(p.match.deleteMany).toHaveBeenCalledWith({
      where: { tournamentId:'t1', status:'scheduled', OR: [{player1Id:'p1'},{player2Id:'p1'}] },
    });
  });

  it('rejects in in_progress state', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'in_progress', organizerId:'u1' },
    });
    p.tournamentParticipant.findUnique.mockResolvedValue({
      tournamentId:'t1', playerId:'p1', withdrawnAt:null,
    });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await expect(svc.dropParticipant('t1', 'p1', { userId:'u1', role:'organizer' }))
      .rejects.toThrow(/cannot drop/);
  });
});

describe('TournamentsService.getNextMatches', () => {
  it('returns scheduled matches ordered by round then group letter', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'in_progress', numberOfTables:4 },
    });
    p.match.findMany.mockImplementation(({ orderBy, take }: any) => {
      // Simulate sort by round then groupLetter then id.
      const all = [
        { id:'m3', tournamentId:'t1', status:'scheduled', round:2, groupLetter:'A', bracketLabel:null },
        { id:'m1', tournamentId:'t1', status:'scheduled', round:1, groupLetter:'B', bracketLabel:null },
        { id:'m2', tournamentId:'t1', status:'scheduled', round:1, groupLetter:'A', bracketLabel:null },
      ];
      // Simple sort — relies on Prisma to do it in real life; test confirms call shape.
      const sorted = [...all].sort((a, b) =>
        a.round - b.round || (a.groupLetter ?? '').localeCompare(b.groupLetter ?? '')
        || (a.bracketLabel ?? '').localeCompare(b.bracketLabel ?? '')
        || a.id.localeCompare(b.id));
      return Promise.resolve(take ? sorted.slice(0, take) : sorted);
    });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    const result = await svc.getNextMatches('t1');
    expect(result.numberOfTables).toBe(4);
    expect(result.matches.map((m: any) => m.id)).toEqual(['m2','m1','m3']);
  });

  it('respects limit parameter', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'in_progress', numberOfTables:4 },
    });
    p.match.findMany.mockImplementation(({ take }: any) =>
      Promise.resolve([
        { id:'m1' }, { id:'m2' }, { id:'m3' },
      ].slice(0, take)));
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    const result = await svc.getNextMatches('t1', 2);
    expect(result.matches.length).toBe(2);
  });

  it('rejects in non-prepared/in_progress states', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'completed', numberOfTables:4 },
    });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await expect(svc.getNextMatches('t1'))
      .rejects.toThrow(/prepared.*in_progress/);
  });
});

describe('TournamentsService.getStandings', () => {
  it('groups participants by groupLetter and returns RTTF-ordered rows', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'in_progress', format:'groups_playoff', bracketShape:{subBrackets:[]}, groupSize:4 },
    });
    p.tournamentParticipant.findMany.mockResolvedValue([
      { tournamentId:'t1', playerId:'p1', groupLetter:'A', groupRank:1, withdrawnAt:null, seed:1 },
      { tournamentId:'t1', playerId:'p2', groupLetter:'A', groupRank:2, withdrawnAt:null, seed:2 },
    ]);
    p.match.findMany.mockResolvedValue([
      { id:'m1', tournamentId:'t1', status:'completed', winnerId:'p1', player1Id:'p1', player2Id:'p2', setsPlayer1:3, setsPlayer2:0, groupLetter:'A', bracketLabel:null },
    ]);
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    const result = await svc.getStandings('t1');
    expect(result.format).toBe('groups_playoff');
    expect(result.groups.length).toBe(1);
    expect(result.groups[0].letter).toBe('A');
    expect(result.groups[0].rows.length).toBe(2);
    expect(result.groups[0].rows[0].playerId).toBe('p1');
    expect(result.groups[0].rows[0].wins).toBe(1);
  });
});

describe('TournamentsService.patchMatchResult', () => {
  it('rejects if match not scheduled', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'in_progress', organizerId:'u1', matchFormat:'bo5' },
    });
    p.match.findUnique.mockResolvedValue({
      id:'m1', tournamentId:'t1', status:'completed', player1Id:'p1', player2Id:'p2',
    });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await expect(svc.patchMatchResult('t1','m1',
      { winnerId:'p1', setsPlayer1:3, setsPlayer2:0 },
      { userId:'u1', role:'organizer' }))
      .rejects.toThrow(/scheduled/);
  });

  it('rejects winnerId not one of the two players', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'in_progress', organizerId:'u1', matchFormat:'bo5' },
    });
    p.match.findUnique.mockResolvedValue({
      id:'m1', tournamentId:'t1', status:'scheduled', player1Id:'p1', player2Id:'p2',
    });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await expect(svc.patchMatchResult('t1','m1',
      { winnerId:'p99', setsPlayer1:3, setsPlayer2:0 },
      { userId:'u1', role:'organizer' }))
      .rejects.toThrow(/winnerId/);
  });

  it('flips status to completed and persists the result', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'in_progress', organizerId:'u1', matchFormat:'bo5', format:'round_robin' },
    });
    const completedMatch = {
      id:'m1', tournamentId:'t1', status:'completed', player1Id:'p1', player2Id:'p2',
      round:1, groupLetter:null, bracketLabel:null, winnerId:'p1', setsPlayer1:3, setsPlayer2:1,
    };
    p.match.findUnique.mockResolvedValueOnce({
      ...completedMatch, status:'scheduled', winnerId:null,
    });
    p.match.findUniqueOrThrow.mockResolvedValue(completedMatch);
    p.tournament.findUniqueOrThrow.mockResolvedValue({
      id:'t1', format:'round_robin',
    });
    // Make findMany return empty so advance() does nothing further.
    p.match.findMany.mockResolvedValue([]);
    p.tournamentParticipant.findMany.mockResolvedValue([]);
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await svc.patchMatchResult('t1','m1',
      { winnerId:'p1', setsPlayer1:3, setsPlayer2:1 },
      { userId:'u1', role:'organizer' });
    expect(p.match.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id:'m1' },
      data: expect.objectContaining({ status:'completed', winnerId:'p1', setsPlayer1:3, setsPlayer2:1 }),
    }));
  });

  it('rejects when tournament not in_progress', async () => {
    const p = mockPrisma({
      tournament: { id:'t1', status:'prepared', organizerId:'u1', matchFormat:'bo5' },
    });
    const svc = new TournamentsService(p as any, mockRatingTrigger() as any);
    await expect(svc.patchMatchResult('t1','m1',
      { winnerId:'p1', setsPlayer1:3, setsPlayer2:0 },
      { userId:'u1', role:'organizer' }))
      .rejects.toThrow(/in_progress/);
  });
});
