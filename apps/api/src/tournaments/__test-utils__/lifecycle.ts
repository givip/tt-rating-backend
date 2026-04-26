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
