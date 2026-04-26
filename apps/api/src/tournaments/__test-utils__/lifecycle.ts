import { expect } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@tt-rating/db/generated';
import { playOutTournament, type ResultOverride } from './play-out';

/**
 * Drive a tournament from `open` through `prepare → start → playOut →
 * finalize`. Each HTTP call's status is asserted via vitest's expect.
 * Throws if any step fails.
 */
export async function runFullLifecycle(
  app: NestFastifyApplication,
  organizerToken: string,
  prisma: PrismaClient,
  tournamentId: string,
  prepareBody: Record<string, unknown>,
  overrides?: Map<string, ResultOverride>,
): Promise<void> {
  const prep = await app.inject({
    method: 'POST',
    url: `/api/v1/tournaments/${tournamentId}/prepare`,
    headers: { authorization: `Bearer ${organizerToken}` },
    payload: prepareBody,
  });
  expect(prep.statusCode).toBe(201);

  const start = await app.inject({
    method: 'POST',
    url: `/api/v1/tournaments/${tournamentId}/start`,
    headers: { authorization: `Bearer ${organizerToken}` },
  });
  expect(start.statusCode).toBe(201);

  await playOutTournament(app, organizerToken, prisma, tournamentId, { overrides });

  const fin = await app.inject({
    method: 'PATCH',
    url: `/api/v1/tournaments/${tournamentId}/finalize`,
    headers: { authorization: `Bearer ${organizerToken}` },
  });
  expect(fin.statusCode).toBe(200);
}

/**
 * Propose a casual match (proposer's token), then accept it (opponent's
 * token). Asserts both calls succeed. The rating-job runs in-process when
 * the accept fires (InProcessRatingJobTrigger calls processCasualMatch
 * synchronously).
 *
 * Default scoreline is `setsPlayer1=3, setsPlayer2=0` (winner takes all).
 * Override either to script different match shapes.
 */
export async function playCasualMatch(
  app: NestFastifyApplication,
  prisma: PrismaClient,
  opts: {
    proposerToken: string;
    opponentToken: string;
    opponentPlayerId: string;
    winnerPlayerId: string;
    setsPlayer1?: number;
    setsPlayer2?: number;
  },
): Promise<{ matchId: string }> {
  const setsPlayer1 = opts.setsPlayer1 ?? 3;
  const setsPlayer2 = opts.setsPlayer2 ?? 0;

  // Step 1: proposer creates the match.
  const proposeRes = await app.inject({
    method: 'POST',
    url: '/api/v1/casual-matches',
    headers: { authorization: `Bearer ${opts.proposerToken}` },
    payload: {
      opponentId: opts.opponentPlayerId,
      winnerId: opts.winnerPlayerId,
      setsPlayer1,
      setsPlayer2,
    },
  });
  if (proposeRes.statusCode !== 201) {
    throw new Error(
      `casual propose failed: ${proposeRes.statusCode} ${proposeRes.body}`,
    );
  }
  const { id: matchId } = proposeRes.json() as { id: string };

  // Step 2: opponent accepts.
  const acceptRes = await app.inject({
    method: 'POST',
    url: `/api/v1/casual-matches/${matchId}/accept`,
    headers: { authorization: `Bearer ${opts.opponentToken}` },
  });
  if (acceptRes.statusCode !== 200 && acceptRes.statusCode !== 201) {
    throw new Error(
      `casual accept failed: ${acceptRes.statusCode} ${acceptRes.body}`,
    );
  }

  // `prisma` reserved for future use (e.g. confirming the rating-change
  // rows landed before returning); not needed for the v1 helper.
  void prisma;

  return { matchId };
}
