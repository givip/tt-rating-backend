import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MATCH_WEIGHTS } from '@tt-rating/core';
import { PrismaService } from '../common/prisma.service';
import {
  RATING_JOB_TRIGGER,
  type RatingJobTrigger,
} from '../rating/rating-job-trigger.interface';

export interface Actor {
  userId: string;
  role: string;
}

const CASUAL_EXPIRY_DAYS = 7;
const DEFAULT_CASUAL_MULTIPLIER = 0.3;
const NON_PROVISIONAL_THRESHOLD = 5;

@Injectable()
export class CasualMatchesService {
  constructor(
    private prisma: PrismaService,
    @Inject(RATING_JOB_TRIGGER) private ratingJob: RatingJobTrigger,
  ) {}

  async propose(
    input: {
      opponentId: string;
      winnerId: string;
      setsPlayer1: number;
      setsPlayer2: number;
      playedAt?: Date | null;
    },
    actor: Actor,
  ) {
    const proposer = await this.prisma.player.findUnique({
      where: { userId: actor.userId },
    });
    if (!proposer) throw new NotFoundException('Proposer player profile not found');

    if (proposer.id === input.opponentId) {
      throw new BadRequestException('Cannot propose a match against the same player');
    }

    if (proposer.tournamentsPlayed < NON_PROVISIONAL_THRESHOLD) {
      throw new BadRequestException(
        'Provisional players cannot propose casual matches (must have \u2265 5 tournaments)',
      );
    }

    const opponent = await this.prisma.player.findUnique({
      where: { id: input.opponentId },
    });
    if (!opponent) throw new NotFoundException('Opponent not found');

    if (input.winnerId !== proposer.id && input.winnerId !== opponent.id) {
      throw new BadRequestException('winnerId must be one of the two players');
    }

    const winnerSets =
      input.winnerId === proposer.id ? input.setsPlayer1 : input.setsPlayer2;
    const loserSets =
      input.winnerId === proposer.id ? input.setsPlayer2 : input.setsPlayer1;
    if (winnerSets <= loserSets) {
      throw new BadRequestException(
        "winner's set count must be greater than loser's",
      );
    }

    const multiplier = await this.readCasualMultiplier();
    const bo5Weight = (MATCH_WEIGHTS.bo5 as Record<string, number>)[
      `${winnerSets}:${loserSets}`
    ];
    if (bo5Weight === undefined) {
      throw new BadRequestException(
        `Invalid bo5 score ${winnerSets}:${loserSets} — allowed: 3:0, 3:1, 3:2`,
      );
    }
    const matchWeight = bo5Weight * multiplier;

    const expiresAt = new Date(Date.now() + CASUAL_EXPIRY_DAYS * 86400 * 1000);

    return this.prisma.match.create({
      data: {
        tournamentId: null,
        matchType: 'casual',
        proposerId: proposer.id,
        round: 1,
        player1Id: proposer.id,
        player2Id: opponent.id,
        winnerId: input.winnerId,
        setsPlayer1: input.setsPlayer1,
        setsPlayer2: input.setsPlayer2,
        matchWeight,
        playedAt: input.playedAt ?? null,
        expiresAt,
        status: 'pending_opponent',
        enteredBy: actor.userId,
      },
    });
  }

  async accept(matchId: string, actor: Actor) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Match not found');

    const caller = await this.prisma.player.findUnique({
      where: { userId: actor.userId },
    });
    if (!caller || caller.id !== match.player2Id) {
      throw new BadRequestException('Only the opponent can accept this match');
    }

    if (match.status !== 'pending_opponent') {
      throw new BadRequestException(
        `Match is not pending (status=${match.status})`,
      );
    }

    if (match.expiresAt && match.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Match has expired');
    }

    // Atomic status transition: only flip to `confirmed` if still pending.
    // Guards against two concurrent accepts or an accept/cancel race.
    const result = await this.prisma.match.updateMany({
      where: { id: matchId, status: 'pending_opponent' },
      data: { status: 'confirmed', confirmedAt: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        'Match is no longer pending (may have been accepted, rejected, or cancelled by another request)',
      );
    }

    // Fire-and-forget: failure here should surface via logging, not block the
    // accept response. Await to propagate synchronous validation errors from
    // the trigger (e.g. wrong args), but the actual rating job runs async in
    // production (Cloud Run Job).
    await this.ratingJob.trigger({ matchId });

    return this.prisma.match.findUnique({ where: { id: matchId } });
  }

  async reject(matchId: string, actor: Actor) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Match not found');

    const caller = await this.prisma.player.findUnique({
      where: { userId: actor.userId },
    });
    if (!caller || caller.id !== match.player2Id) {
      throw new BadRequestException('Only the opponent can reject this match');
    }

    if (match.status !== 'pending_opponent') {
      throw new BadRequestException(
        `Match is not pending (status=${match.status})`,
      );
    }

    const result = await this.prisma.match.updateMany({
      where: { id: matchId, status: 'pending_opponent' },
      data: { status: 'rejected' },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        'Match is no longer pending (may have been accepted, rejected, or cancelled by another request)',
      );
    }

    return this.prisma.match.findUnique({ where: { id: matchId } });
  }

  async cancel(matchId: string, actor: Actor) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Match not found');

    const caller = await this.prisma.player.findUnique({
      where: { userId: actor.userId },
    });
    if (!caller || caller.id !== match.proposerId) {
      throw new BadRequestException('Only the proposer can cancel this match');
    }

    if (match.status !== 'pending_opponent') {
      throw new BadRequestException(
        `Match cannot be cancelled (status=${match.status})`,
      );
    }

    const result = await this.prisma.match.deleteMany({
      where: { id: matchId, status: 'pending_opponent' },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        'Match is no longer pending (may have been accepted, rejected, or cancelled by another request)',
      );
    }
    return { ok: true };
  }

  async listPending(actor: Actor) {
    const caller = await this.prisma.player.findUnique({
      where: { userId: actor.userId },
    });
    if (!caller) throw new NotFoundException('Player profile not found');

    return this.prisma.match.findMany({
      where: {
        matchType: 'casual',
        status: 'pending_opponent',
        player2Id: caller.id,
      },
      orderBy: { playedAt: 'desc' },
    });
  }

  async historyForPlayer(playerId: string) {
    return this.prisma.match.findMany({
      where: {
        matchType: 'casual',
        OR: [{ player1Id: playerId }, { player2Id: playerId }],
      },
      orderBy: { playedAt: 'desc' },
    });
  }

  /**
   * Nightly cron target: flip overdue pending matches to `expired`. Bulk
   * updateMany keeps the operation single-statement so a large backlog
   * doesn't slow down the cron.
   */
  async expireOverdue(): Promise<{ expired: number }> {
    const now = new Date();
    const result = await this.prisma.match.updateMany({
      where: {
        matchType: 'casual',
        status: 'pending_opponent',
        expiresAt: { lt: now },
      },
      data: { status: 'expired' },
    });
    return { expired: result.count };
  }

  private async readCasualMultiplier(): Promise<number> {
    const row = await this.prisma.ratingConfig.findUnique({
      where: { key: 'casual_weight_multiplier' },
    });
    const v = row?.value;
    return typeof v === 'number' && Number.isFinite(v)
      ? v
      : DEFAULT_CASUAL_MULTIPLIER;
  }
}
