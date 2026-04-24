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
}
