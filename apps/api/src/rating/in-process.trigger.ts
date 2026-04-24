import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { processCasualMatch, processTournament } from '@tt-rating/rating-job';
import { PrismaService } from '../common/prisma.service';
import type {
  RatingJobInput,
  RatingJobTrigger,
} from './rating-job-trigger.interface';

/**
 * Default `RatingJobTrigger` binding. Runs the rating worker synchronously
 * in the API process against the shared `PrismaService` connection. Good
 * for dev, tests, and small self-hosted deployments where the API can
 * afford to block on a rating recalculation.
 *
 * Production deployments that need the job out-of-band (separate container,
 * scale-to-zero, retry semantics, etc.) override this binding from their
 * platform module — see `RATING_JOB_TRIGGER` in the interface file.
 */
@Injectable()
export class InProcessRatingJobTrigger implements RatingJobTrigger {
  constructor(private prisma: PrismaService) {}

  async trigger(input: RatingJobInput): Promise<void> {
    const { tournamentId, matchId } = input;
    if ((tournamentId == null) === (matchId == null)) {
      throw new InternalServerErrorException(
        'RatingJobTrigger: exactly one of { tournamentId, matchId } must be set',
      );
    }
    if (tournamentId) {
      await processTournament(tournamentId, this.prisma);
    } else {
      await processCasualMatch(matchId!, this.prisma);
    }
  }
}
