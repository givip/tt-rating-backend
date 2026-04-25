import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  RATING_JOB_TRIGGER,
  type RatingJobTrigger,
} from '../rating/rating-job-trigger.interface';
import { MATCH_WEIGHTS } from '@tt-rating/core';
import { distributeIntoGroups } from './draw/group-draw';
import { generateRoundRobinPairings } from './draw/round-robin';
import { buildPlacementBrackets } from './draw/bracket-shape';
import { seedParticipants } from './draw/seeding';
import { advanceBracket } from './draw/advance';
import { computeGroupStandings } from './draw/tiebreakers';

/**
 * The authenticated caller, as attached to the request by `JwtAuthGuard`.
 * Passed into service methods that need to enforce ownership so the rule
 * stays verifiable without spinning up an HTTP layer in unit tests.
 */
export interface Actor {
  userId: string;
  role: string;
}

@Injectable()
export class TournamentsService {
  constructor(
    private prisma: PrismaService,
    @Inject(RATING_JOB_TRIGGER) private ratingJob: RatingJobTrigger,
  ) {}

  validateParticipantCount(count: number): void {
    if (count < 4) {
      throw new BadRequestException(
        'Tournament must have at least 4 participants for ratings to be affected',
      );
    }
  }

  /**
   * Admin can modify any tournament; organizer can modify only their own.
   * Throws `ForbiddenException` otherwise. Caller is responsible for having
   * already loaded the tournament (we keep this as a pure predicate to avoid
   * a duplicate DB round-trip).
   */
  private assertCanModify(tournament: { organizerId: string }, actor: Actor): void {
    if (actor.role === 'admin') return;
    if (tournament.organizerId !== actor.userId) {
      throw new ForbiddenException('Not the organizer of this tournament');
    }
  }

  calculateMatchWeight(
    format: 'bo3' | 'bo5' | 'bo7',
    winnerSets: number,
    loserSets: number,
  ): number {
    const key = `${winnerSets}:${loserSets}` as keyof (typeof MATCH_WEIGHTS)[typeof format];
    return (MATCH_WEIGHTS[format] as Record<string, number>)[key] ?? 1.0;
  }

  async findAll(organizerId?: string) {
    return this.prisma.tournament.findMany({
      where: organizerId ? { organizerId } : undefined,
      orderBy: { startsAt: 'desc' },
      include: { club: { select: { id: true, nameKa: true, nameEn: true } } },
    });
  }

  async findOne(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        participants: {
          include: { player: { select: { id: true, firstNameKa: true, lastNameKa: true } } },
        },
        matches: { orderBy: { round: 'asc' } },
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    return tournament;
  }

  async create(actor: Actor, dto: Record<string, unknown>) {
    // organizerId always comes from the authenticated caller — never from
    // the request body — so an organizer can't forge one owned by someone
    // else. Admins still get their own user.id as organizer; if they need
    // to create on behalf of an organizer, that's a separate privileged
    // endpoint (not in this phase).
    return this.prisma.tournament.create({
      data: { ...(dto as any), organizerId: actor.userId },
    });
  }

  async addParticipant(tournamentId: string, playerId: string, actor: Actor) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, organizerId: true, minRating: true, maxRating: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    this.assertCanModify(tournament, actor);

    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found');

    // Rating gates are inclusive on both ends so "1800 min" means "≥ 1800",
    // matching how organizers describe bracket cutoffs in practice.
    if (tournament.minRating != null && player.internalRating < tournament.minRating) {
      throw new BadRequestException(
        `Player below min rating (${player.internalRating} < ${tournament.minRating})`,
      );
    }
    if (tournament.maxRating != null && player.internalRating > tournament.maxRating) {
      throw new BadRequestException(
        `Player above max rating (${player.internalRating} > ${tournament.maxRating})`,
      );
    }

    return this.prisma.tournamentParticipant.create({
      data: {
        tournamentId,
        playerId,
        ratingBefore: player.internalRating,
        rdBefore: player.rd,
      },
    });
  }

  /**
   * Create a match within a tournament. Mutations are blocked once the
   * tournament has been processed — that's the moment its matches become
   * the input to the rating recompute, and retroactive changes would
   * invalidate every downstream RatingChange / leaderboard row.
   *
   * `matchWeight` is derived from the tournament's `matchFormat` + set
   * counts so organizers never set it directly — the Glicko engine treats
   * weight as a decisive-ness multiplier, and letting organizers pick it
   * would be a trivial way to rig ratings.
   */
  async createMatch(
    tournamentId: string,
    input: {
      round: number;
      player1Id: string;
      player2Id: string;
      winnerId?: string | null;
      setsPlayer1?: number | null;
      setsPlayer2?: number | null;
      scoreDetails?: unknown;
      playedAt?: Date | null;
    },
    actor: Actor,
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        id: true,
        organizerId: true,
        processed: true,
        matchFormat: true,
        participants: { select: { playerId: true } },
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    this.assertCanModify(tournament, actor);

    if (tournament.processed) {
      throw new BadRequestException(
        'Cannot add matches to a processed tournament',
      );
    }

    if (input.player1Id === input.player2Id) {
      throw new BadRequestException('player1Id and player2Id must differ');
    }

    const participantIds = new Set(tournament.participants.map((p) => p.playerId));
    if (!participantIds.has(input.player1Id) || !participantIds.has(input.player2Id)) {
      throw new BadRequestException('Both players must be tournament participants');
    }

    if (input.winnerId != null && input.winnerId !== input.player1Id && input.winnerId !== input.player2Id) {
      throw new BadRequestException('winnerId must be one of the two players');
    }

    const s1 = input.setsPlayer1;
    const s2 = input.setsPlayer2;
    const hasSets = s1 != null || s2 != null;
    if (hasSets && (s1 == null || s2 == null)) {
      throw new BadRequestException(
        'setsPlayer1 and setsPlayer2 must both be provided or both omitted',
      );
    }

    let matchWeight = 1.0;
    if (hasSets && input.winnerId != null) {
      const winnerSets = input.winnerId === input.player1Id ? s1! : s2!;
      const loserSets = input.winnerId === input.player1Id ? s2! : s1!;
      if (winnerSets <= loserSets) {
        throw new BadRequestException(
          "winner's set count must be greater than loser's",
        );
      }
      matchWeight = this.calculateMatchWeight(
        tournament.matchFormat,
        winnerSets,
        loserSets,
      );
    }

    // A match with a winner + sets is already a recorded result; anything
    // missing either is still pending. We deliberately don't surface an
    // "in_progress" shortcut here — organizers can PATCH the row later
    // when that endpoint lands.
    const status = input.winnerId != null && hasSets ? 'completed' : 'scheduled';

    return this.prisma.match.create({
      data: {
        tournamentId,
        round: input.round,
        player1Id: input.player1Id,
        player2Id: input.player2Id,
        winnerId: input.winnerId ?? null,
        setsPlayer1: s1 ?? null,
        setsPlayer2: s2 ?? null,
        scoreDetails: (input.scoreDetails as any) ?? null,
        matchWeight,
        playedAt: input.playedAt ?? null,
        enteredBy: actor.userId,
        status,
      },
    });
  }

  async finalize(tournamentId: string, actor: Actor) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { _count: { select: { participants: true } } },
    });

    if (!tournament) throw new NotFoundException('Tournament not found');
    this.assertCanModify(tournament, actor);

    if (tournament.processed) return { message: 'Tournament already processed' };

    this.validateParticipantCount(tournament._count.participants);

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: 'completed' },
    });

    await this.ratingJob.trigger({ tournamentId });

    return { message: 'Tournament finalized — rating calculation queued' };
  }

  /**
   * Transition a tournament from `open` to `prepared` by running the chosen
   * draw and persisting all of: format selection, seeded participants, group
   * letters (if any), generated `Match` rows, and the playoff `bracketShape`.
   *
   * v1 supports only `round_robin` and `groups_playoff`. Everything happens
   * inside a single Prisma transaction — we don't want to leave a half-drawn
   * tournament behind if the rating-of-an-individual update fails partway.
   */
  async prepare(
    tournamentId: string,
    body: {
      format: 'round_robin' | 'groups_playoff' | 'single_elim' | 'swiss';
      matchFormat?: 'bo3' | 'bo5' | 'bo7';
      groupSize?: 3 | 4 | 5;
      hasThirdPlaceMatch?: boolean;
      seedOverrides?: Record<string, number>;
    },
    actor: Actor,
  ): Promise<void> {
    if (body.format !== 'round_robin' && body.format !== 'groups_playoff') {
      throw new BadRequestException(`unsupported format in v1: ${body.format}`);
    }
    if (body.format === 'round_robin' && body.groupSize != null) {
      throw new BadRequestException('groupSize is not valid for round_robin');
    }
    const groupSize = body.groupSize ?? 4;

    await this.prisma.$transaction(async (tx: any) => {
      const t = await tx.tournament.findUnique({ where: { id: tournamentId } });
      if (!t) throw new NotFoundException('Tournament not found');
      this.assertCanModify(t, actor);
      if (t.status !== 'open') {
        throw new BadRequestException(
          `tournament must be in open state to prepare; got ${t.status}`,
        );
      }

      const participants = await tx.tournamentParticipant.findMany({
        where: { tournamentId, withdrawnAt: null },
        include: { player: { select: { internalRating: true } } },
      });
      const N = participants.length;
      if (N < 4) throw new BadRequestException('at least 4 participants required');
      if (body.format === 'groups_playoff' && N < 2 * groupSize) {
        throw new BadRequestException(
          `groups_playoff requires at least ${2 * groupSize} participants; got ${N}`,
        );
      }

      // 1. Seed by rating, applying any organizer-supplied overrides.
      const seeded = seedParticipants(
        participants.map((p: any) => ({
          playerId: p.playerId,
          internalRating: p.player.internalRating,
        })),
        body.seedOverrides,
      );

      // 2. Format-specific draw.
      let matchRows: any[] = [];
      let bracketShape: any = null;
      let groupSizeWritten: number | null = null;

      if (body.format === 'round_robin') {
        const pairings = generateRoundRobinPairings(seeded.map((p) => p.playerId));
        matchRows = pairings.map((p) => ({
          tournamentId,
          round: p.round,
          player1Id: p.player1Id,
          player2Id: p.player2Id,
          groupLetter: null,
          bracketLabel: null,
          status: 'scheduled',
          matchType: 'tournament',
          matchWeight: 1.0,
        }));
        for (const sp of seeded) {
          await tx.tournamentParticipant.update({
            where: { tournamentId_playerId: { tournamentId, playerId: sp.playerId } },
            data: { seed: sp.seed },
          });
        }
      } else {
        groupSizeWritten = groupSize;
        const seededWithRating = seeded.map((s) => {
          const orig = participants.find((p: any) => p.playerId === s.playerId)!;
          return {
            playerId: s.playerId,
            seed: s.seed,
            internalRating: orig.player.internalRating,
          };
        });
        const groups = distributeIntoGroups(seededWithRating, groupSize);
        for (const g of groups) {
          const pairings = generateRoundRobinPairings(g.players.map((p) => p.playerId));
          for (const p of pairings) {
            matchRows.push({
              tournamentId,
              round: p.round,
              player1Id: p.player1Id,
              player2Id: p.player2Id,
              groupLetter: g.letter,
              bracketLabel: null,
              status: 'scheduled',
              matchType: 'tournament',
              matchWeight: 1.0,
            });
          }
          for (const sp of g.players) {
            await tx.tournamentParticipant.update({
              where: { tournamentId_playerId: { tournamentId, playerId: sp.playerId } },
              data: { seed: sp.seed, groupLetter: g.letter },
            });
          }
        }
        bracketShape = buildPlacementBrackets(groups.length, groupSize);
      }

      if (matchRows.length > 0) {
        await tx.match.createMany({ data: matchRows });
      }
      await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          format: body.format,
          matchFormat: body.matchFormat ?? 'bo5',
          groupSize: groupSizeWritten,
          bracketShape: bracketShape as any,
          hasThirdPlaceMatch: body.hasThirdPlaceMatch ?? false,
          status: 'prepared',
        },
      });
    });
  }

  /**
   * Undo a `prepare()` so the organizer can re-draw. Allowed only while the
   * tournament is still in `prepared` and no match has been played yet —
   * deleting completed matches would silently invalidate the rating-impact
   * preview shown to participants.
   */
  async rewind(tournamentId: string, actor: Actor): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      const t = await tx.tournament.findUnique({ where: { id: tournamentId } });
      if (!t) throw new NotFoundException('Tournament not found');
      this.assertCanModify(t, actor);
      if (t.status !== 'prepared') {
        throw new BadRequestException(
          `can only rewind from prepared; got ${t.status}`,
        );
      }
      const completed = await tx.match.count({
        where: { tournamentId, status: 'completed' },
      });
      if (completed > 0) {
        throw new BadRequestException(
          `cannot rewind: ${completed} completed match(es) already`,
        );
      }
      await tx.match.deleteMany({ where: { tournamentId } });
      await tx.tournamentParticipant.updateMany({
        where: { tournamentId },
        data: { seed: null, groupLetter: null, groupRank: null },
      });
      await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          status: 'open',
          format: null,
          bracketShape: null,
          groupSize: null,
        },
      });
    });
  }

  /**
   * Drop a participant from a tournament. The behaviour depends on state:
   * in `draft`/`open` we hard-delete the row (no draw exists yet, so there's
   * nothing to reconcile); in `prepared` we soft-delete via `withdrawnAt`
   * and purge the `scheduled` matches that name them so the bracket stays
   * consistent. Once the tournament has actually started, dropping is
   * forbidden — losing a player mid-event has rating consequences that
   * belong to a future "forfeit" flow rather than a silent removal.
   */
  async dropParticipant(
    tournamentId: string,
    playerId: string,
    actor: Actor,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      const t = await tx.tournament.findUnique({ where: { id: tournamentId } });
      if (!t) throw new NotFoundException('Tournament not found');
      this.assertCanModify(t, actor);

      const p = await tx.tournamentParticipant.findUnique({
        where: { tournamentId_playerId: { tournamentId, playerId } },
      });
      if (!p || p.withdrawnAt != null) {
        throw new NotFoundException('Participant not found in this tournament');
      }

      if (t.status === 'draft' || t.status === 'open') {
        await tx.tournamentParticipant.delete({
          where: { tournamentId_playerId: { tournamentId, playerId } },
        });
        return;
      }
      if (t.status === 'prepared') {
        await tx.tournamentParticipant.update({
          where: { tournamentId_playerId: { tournamentId, playerId } },
          data: { withdrawnAt: new Date() },
        });
        await tx.match.deleteMany({
          where: {
            tournamentId,
            status: 'scheduled',
            OR: [{ player1Id: playerId }, { player2Id: playerId }],
          },
        });
        return;
      }
      throw new BadRequestException(
        `cannot drop participant in ${t.status} state`,
      );
    });
  }

  /**
   * Flip a `prepared` tournament into `in_progress`. Pure status change —
   * the draw is already persisted by `prepare()`, so this is the moment
   * organizers commit to that draw and start scheduling matches.
   */
  /**
   * Record a result on a previously-`scheduled` match and immediately drive
   * the bracket forward in the same transaction. Bundling the update and
   * `advanceBracket()` into one tx is intentional: a partially-advanced
   * bracket (result persisted but next round not generated) would silently
   * stall the tournament until someone noticed, so we'd rather fail the
   * whole patch than leave the system in that state.
   */
  async patchMatchResult(
    tournamentId: string,
    matchId: string,
    body: {
      winnerId: string;
      setsPlayer1: number;
      setsPlayer2: number;
      scoreDetails?: unknown;
      playedAt?: Date;
    },
    actor: Actor,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      const t = await tx.tournament.findUnique({ where: { id: tournamentId } });
      if (!t) throw new NotFoundException('Tournament not found');
      this.assertCanModify(t, actor);
      if (t.status !== 'in_progress') {
        throw new BadRequestException(
          `can only enter results in in_progress; got ${t.status}`,
        );
      }
      const m = await tx.match.findUnique({ where: { id: matchId } });
      if (!m || m.tournamentId !== tournamentId) {
        throw new NotFoundException('Match not found in this tournament');
      }
      if (m.status !== 'scheduled') {
        throw new BadRequestException(
          `match must be scheduled to record result; got ${m.status}`,
        );
      }
      if (body.winnerId !== m.player1Id && body.winnerId !== m.player2Id) {
        throw new BadRequestException('winnerId must be one of the two players');
      }
      const winnerSets =
        body.winnerId === m.player1Id ? body.setsPlayer1 : body.setsPlayer2;
      const loserSets =
        body.winnerId === m.player1Id ? body.setsPlayer2 : body.setsPlayer1;
      if (winnerSets <= loserSets) {
        throw new BadRequestException(
          "winner's set count must be greater than loser's",
        );
      }
      const matchWeight = this.calculateMatchWeight(
        t.matchFormat,
        winnerSets,
        loserSets,
      );

      await tx.match.update({
        where: { id: matchId },
        data: {
          winnerId: body.winnerId,
          setsPlayer1: body.setsPlayer1,
          setsPlayer2: body.setsPlayer2,
          scoreDetails: (body.scoreDetails as any) ?? null,
          playedAt: body.playedAt ?? new Date(),
          matchWeight,
          status: 'completed',
          enteredBy: actor.userId,
        },
      });

      await advanceBracket(tournamentId, matchId, tx);
    });
  }

  async getNextMatches(
    tournamentId: string,
    limit?: number,
  ): Promise<{ numberOfTables: number; matches: any[] }> {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new NotFoundException('Tournament not found');
    if (t.status !== 'prepared' && t.status !== 'in_progress') {
      throw new BadRequestException(
        `next-matches available only in prepared or in_progress; got ${t.status}`,
      );
    }
    const cap = limit ?? t.numberOfTables;
    const matches = await this.prisma.match.findMany({
      where: { tournamentId, status: 'scheduled' },
      orderBy: [
        { round: 'asc' },
        { groupLetter: 'asc' },
        { bracketLabel: 'asc' },
        { id: 'asc' },
      ],
      take: cap,
    });
    return { numberOfTables: t.numberOfTables, matches };
  }

  async getStandings(tournamentId: string): Promise<{
    format: string | null;
    groups: Array<{ letter: string; rows: any[] }>;
    brackets: Array<{ label: string; matches: any[]; finalPositions?: Record<string, number> }>;
  }> {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new NotFoundException('Tournament not found');
    if (t.status === 'draft' || t.status === 'open') {
      throw new BadRequestException(`standings unavailable in ${t.status}`);
    }
    const participants = await this.prisma.tournamentParticipant.findMany({
      where: { tournamentId, withdrawnAt: null },
    });
    const matches = await this.prisma.match.findMany({ where: { tournamentId } });

    const groupLetters = [...new Set(
      participants.map((p: any) => p.groupLetter).filter((x: any): x is string => x != null),
    )].sort();
    const groups = groupLetters.map(letter => {
      const groupParticipants = participants.filter((p: any) => p.groupLetter === letter);
      const groupMatches = matches.filter((m: any) => m.groupLetter === letter && m.status === 'completed');
      const standings = computeGroupStandings(
        groupMatches.map((m: any) => ({
          player1Id: m.player1Id, player2Id: m.player2Id,
          winnerId: m.winnerId!,
          setsPlayer1: m.setsPlayer1!, setsPlayer2: m.setsPlayer2!,
        })),
        groupParticipants.map((p: any) => ({ playerId: p.playerId })),
      );
      const seedById = new Map(groupParticipants.map((p: any) => [p.playerId, p.seed]));
      return {
        letter,
        rows: standings.map(s => ({
          ...s,
          seed: seedById.get(s.playerId) ?? null,
        })),
      };
    });

    // Round-robin (no groupLetter): single "" group containing everyone.
    if (groups.length === 0 && participants.length > 0) {
      const standings = computeGroupStandings(
        matches.filter((m: any) => m.status === 'completed').map((m: any) => ({
          player1Id: m.player1Id, player2Id: m.player2Id,
          winnerId: m.winnerId!,
          setsPlayer1: m.setsPlayer1!, setsPlayer2: m.setsPlayer2!,
        })),
        participants.map((p: any) => ({ playerId: p.playerId })),
      );
      const seedById = new Map(participants.map((p: any) => [p.playerId, p.seed]));
      groups.push({
        letter: '',
        rows: standings.map(s => ({ ...s, seed: seedById.get(s.playerId) ?? null })),
      });
    }

    const bracketLabels = [...new Set(
      matches.map((m: any) => m.bracketLabel).filter((x: any): x is string => x != null),
    )].sort();
    const brackets = bracketLabels.map(label => ({
      label,
      matches: matches.filter((m: any) => m.bracketLabel === label),
    }));

    return { format: t.format, groups, brackets };
  }

  async start(tournamentId: string, actor: Actor): Promise<void> {
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!t) throw new NotFoundException('Tournament not found');
    this.assertCanModify(t, actor);
    if (t.status !== 'prepared') {
      throw new BadRequestException(
        `can only start from prepared; got ${t.status}`,
      );
    }
    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: 'in_progress' },
    });
  }
}
