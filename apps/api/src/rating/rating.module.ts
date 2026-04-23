import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { InProcessRatingJobTrigger } from './in-process.trigger';
import { RATING_JOB_TRIGGER } from './rating-job-trigger.interface';

/**
 * Provides the `RATING_JOB_TRIGGER` token with the in-process default.
 * Platform repos (e.g. ttr.ge) override this by re-binding the token to
 * their own adapter (Cloud Run, pub/sub, etc.) from a higher-priority
 * module.
 */
@Module({
  providers: [
    PrismaService,
    { provide: RATING_JOB_TRIGGER, useClass: InProcessRatingJobTrigger },
  ],
  exports: [RATING_JOB_TRIGGER],
})
export class RatingModule {}
