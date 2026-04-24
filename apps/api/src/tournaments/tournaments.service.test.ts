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

const mockPrisma = {
  tournament: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  tournamentParticipant: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  player: { findUnique: vi.fn() },
  match: { create: vi.fn() },
};

const mockRatingJob = { trigger: vi.fn() };

describe('TournamentsService', () => {
  let service: TournamentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TournamentsService(mockPrisma as any, mockRatingJob as any);
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
      mockPrisma.tournament.findUnique.mockResolvedValue(null);
      await expect(
        service.addParticipant('t-nope', 'p1', organizerActor),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a different organizer tries to add', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(tournamentOwnedByOrg1);
      await expect(
        service.addParticipant('t1', 'p1', otherOrganizerActor),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.tournamentParticipant.create).not.toHaveBeenCalled();
    });

    it('admin can add to any tournament', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(tournamentOwnedByOrg1);
      mockPrisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 1650, rd: 120,
      });
      mockPrisma.tournamentParticipant.create.mockResolvedValue({});

      await service.addParticipant('t1', 'p1', adminActor);
      expect(mockPrisma.tournamentParticipant.create).toHaveBeenCalled();
    });

    it('throws NotFoundException when player not found', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(tournamentOwnedByOrg1);
      mockPrisma.player.findUnique.mockResolvedValue(null);
      await expect(
        service.addParticipant('t1', 'p-nonexistent', organizerActor),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates participant with snapshotted rating', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(tournamentOwnedByOrg1);
      mockPrisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 1650, rd: 120,
      });
      mockPrisma.tournamentParticipant.create.mockResolvedValue({ tournamentId: 't1', playerId: 'p1' });

      await service.addParticipant('t1', 'p1', organizerActor);

      expect(mockPrisma.tournamentParticipant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tournamentId: 't1',
          playerId: 'p1',
          ratingBefore: 1650,
          rdBefore: 120,
        }),
      });
    });

    it('rejects a player below tournament.minRating', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        ...tournamentOwnedByOrg1, minRating: 1800, maxRating: null,
      });
      mockPrisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 1650, rd: 120,
      });

      await expect(
        service.addParticipant('t1', 'p1', organizerActor),
      ).rejects.toThrow(/below min rating/i);
      expect(mockPrisma.tournamentParticipant.create).not.toHaveBeenCalled();
    });

    it('rejects a player above tournament.maxRating', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        ...tournamentOwnedByOrg1, minRating: null, maxRating: 1500,
      });
      mockPrisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 1650, rd: 120,
      });

      await expect(
        service.addParticipant('t1', 'p1', organizerActor),
      ).rejects.toThrow(/above max rating/i);
      expect(mockPrisma.tournamentParticipant.create).not.toHaveBeenCalled();
    });

    it('null minRating and maxRating pass through (no constraint)', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(tournamentOwnedByOrg1);
      mockPrisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 50, rd: 120,  // extreme low
      });
      mockPrisma.tournamentParticipant.create.mockResolvedValue({});

      await service.addParticipant('t1', 'p1', organizerActor);
      expect(mockPrisma.tournamentParticipant.create).toHaveBeenCalled();
    });

    it('allows a player exactly at minRating (inclusive)', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        ...tournamentOwnedByOrg1, minRating: 1650, maxRating: null,
      });
      mockPrisma.player.findUnique.mockResolvedValue({
        id: 'p1', internalRating: 1650, rd: 120,
      });
      mockPrisma.tournamentParticipant.create.mockResolvedValue({});

      await service.addParticipant('t1', 'p1', organizerActor);
      expect(mockPrisma.tournamentParticipant.create).toHaveBeenCalled();
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
      mockPrisma.tournament.findUnique.mockResolvedValue(null);
      await expect(service.finalize('t-nonexistent', organizerActor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when a different organizer finalizes', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      await expect(service.finalize('t1', otherOrganizerActor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockRatingJob.trigger).not.toHaveBeenCalled();
    });

    it('admin can finalize any tournament', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      mockPrisma.tournament.update.mockResolvedValue({});
      mockRatingJob.trigger.mockResolvedValue(undefined);

      await service.finalize('t1', adminActor);
      expect(mockRatingJob.trigger).toHaveBeenCalledWith('t1');
    });

    it('returns early if already processed', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        ...base, processed: true, _count: { participants: 8 },
      });
      const result = await service.finalize('t1', organizerActor);
      expect(result.message).toMatch(/already/i);
      expect(mockRatingJob.trigger).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if fewer than 4 participants', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        ...base, _count: { participants: 3 },
      });
      await expect(service.finalize('t1', organizerActor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sets status to completed and triggers rating job', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      mockPrisma.tournament.update.mockResolvedValue({});
      mockRatingJob.trigger.mockResolvedValue(undefined);

      const result = await service.finalize('t1', organizerActor);

      expect(mockPrisma.tournament.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: 'completed' },
      });
      expect(mockRatingJob.trigger).toHaveBeenCalledWith('t1');
      expect(result.message).toBeTruthy();
    });
  });

  describe('create', () => {
    it('uses actor.userId as organizerId', async () => {
      mockPrisma.tournament.create.mockResolvedValue({ id: 't-new' });
      await service.create(organizerActor, { title: 'Foo' });
      expect(mockPrisma.tournament.create).toHaveBeenCalledWith({
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
      mockPrisma.tournament.findUnique.mockResolvedValue(null);
      await expect(
        service.createMatch('t-missing', validInput, organizerActor),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.match.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when caller is not the organizer', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch('t1', validInput, otherOrganizerActor),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.match.create).not.toHaveBeenCalled();
    });

    it('admin can create matches in any tournament', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      mockPrisma.match.create.mockResolvedValue({ id: 'm-new' });
      await service.createMatch('t1', validInput, adminActor);
      expect(mockPrisma.match.create).toHaveBeenCalled();
    });

    it('throws BadRequestException when tournament is already processed', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({ ...base, processed: true });
      await expect(
        service.createMatch('t1', validInput, organizerActor),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when player1Id equals player2Id', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch(
          't1',
          { ...validInput, player2Id: 'p1' },
          organizerActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when a player is not a participant', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch(
          't1',
          { ...validInput, player2Id: 'p-stranger' },
          organizerActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when winnerId is not one of the players', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch(
          't1',
          { ...validInput, winnerId: 'p-other' },
          organizerActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when only one set count is provided', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch(
          't1',
          { ...validInput, setsPlayer2: undefined },
          organizerActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when winner's set count is not greater than loser's", async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      await expect(
        service.createMatch(
          't1',
          { ...validInput, setsPlayer1: 2, setsPlayer2: 3 },
          organizerActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a match with matchWeight derived from the tournament format', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      mockPrisma.match.create.mockResolvedValue({ id: 'm-new' });

      await service.createMatch(
        't1',
        { ...validInput, setsPlayer1: 3, setsPlayer2: 2 },
        organizerActor,
      );

      expect(mockPrisma.match.create).toHaveBeenCalledWith({
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
      mockPrisma.tournament.findUnique.mockResolvedValue(base);
      mockPrisma.match.create.mockResolvedValue({ id: 'm-new' });

      await service.createMatch(
        't1',
        { round: 1, player1Id: 'p1', player2Id: 'p2' },
        organizerActor,
      );

      expect(mockPrisma.match.create).toHaveBeenCalledWith({
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
