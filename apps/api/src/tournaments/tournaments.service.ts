import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CloudRunService } from '../rating/cloud-run.service';
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
    private cloudRun: CloudRunService,
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

    await this.cloudRun.triggerRatingJob(tournamentId);

    return { message: 'Tournament finalized — rating calculation queued' };
  }
}
