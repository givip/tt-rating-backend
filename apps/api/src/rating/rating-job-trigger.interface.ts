/**
 * Abstraction over "run the rating worker for this tournament."
 *
 * Kept deliberately narrow — one verb, one argument — so that platform repos
 * can bind any transport (Cloud Run Job, Kubernetes CronJob, pub/sub, direct
 * in-process call) without each of them leaking its own knobs into the
 * backend. The default binding is `InProcessRatingJobTrigger`, which runs
 * the worker in the same process; production deployments override this via
 * a DI module that provides a `RATING_JOB_TRIGGER` of their choice.
 */
export interface RatingJobTrigger {
  trigger(tournamentId: string): Promise<void>;
}

export const RATING_JOB_TRIGGER = Symbol('RATING_JOB_TRIGGER');
