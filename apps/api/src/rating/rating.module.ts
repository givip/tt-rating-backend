import { DynamicModule, Global, Module, Type } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { InProcessRatingJobTrigger } from './in-process.trigger';
import {
  RATING_JOB_TRIGGER,
  type RatingJobTrigger,
} from './rating-job-trigger.interface';

/**
 * Dynamic module so platform repos can swap the `RATING_JOB_TRIGGER`
 * binding without patching backend. Marked `@Global()` so a single
 * `forRoot()` at `AppModule` level is visible to every feature module.
 *
 *   // Backend default (in-process worker):
 *   RatingModule.forRoot({ trigger: InProcessRatingJobTrigger })
 *
 *   // ttr.ge (Cloud Run):
 *   RatingModule.forRoot({ trigger: CloudRunRatingJobTrigger })
 */
@Global()
@Module({})
export class RatingModule {
  static forRoot(options: {
    trigger: Type<RatingJobTrigger>;
  }): DynamicModule {
    return {
      module: RatingModule,
      providers: [
        PrismaService,
        { provide: RATING_JOB_TRIGGER, useClass: options.trigger },
      ],
      exports: [RATING_JOB_TRIGGER, PrismaService],
    };
  }

  /** Convenience for dev/tests: default in-process binding. */
  static forRootDefault(): DynamicModule {
    return RatingModule.forRoot({ trigger: InProcessRatingJobTrigger });
  }
}
