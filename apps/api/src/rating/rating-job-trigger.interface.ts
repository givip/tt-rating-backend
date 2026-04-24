/**
 * Abstraction over "run the rating worker." Either a tournament finalize or a
 * single casual-match accept. Exactly one of { tournamentId, matchId } must be
 * set — runtime-enforced by each implementation. Kept narrow so platform
 * repos can bind any transport (Cloud Run Job, pub/sub, in-process) without
 * each leaking its own knobs into the backend.
 */
export interface RatingJobInput {
  tournamentId?: string;
  matchId?: string;
}

export interface RatingJobTrigger {
  trigger(input: RatingJobInput): Promise<void>;
}

export const RATING_JOB_TRIGGER = Symbol('RATING_JOB_TRIGGER');
