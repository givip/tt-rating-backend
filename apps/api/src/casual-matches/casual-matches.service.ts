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
