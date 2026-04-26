import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@tt-rating/db/generated';

export type ResultOverride = {
  winnerId: string;
  setsPlayer1: number;
  setsPlayer2: number;
};

/**
 * Order-insensitive key for the override map. Caller uses this to register
 * specific match outcomes by player-pair.
 */
export function pairKey(p1: string, p2: string): string {
  return [p1, p2].sort().join('|');
}

/**
 * Drives a tournament from `in_progress` until next-matches is empty.
 * For each scheduled match: looks up an override (if any) by pairKey,
 * otherwise uses the default rule (lower-seeded player wins 3:0).
 *
 * Stops when next-matches returns []. Does NOT call finalize — caller does
 * that explicitly so they can assert intermediate state.
 */
export async function playOutTournament(
  app: NestFastifyApplication,
  organizerToken: string,
  prisma: PrismaClient,
  tournamentId: string,
  opts: { overrides?: Map<string, ResultOverride> } = {},
): Promise<void> {
  const overrides = opts.overrides ?? new Map<string, ResultOverride>();

  // Cache participant seeds to avoid re-querying for every match.
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId },
    select: { playerId: true, seed: true },
  });
  const seedById = new Map<string, number>(
    participants
      .filter((p): p is { playerId: string; seed: number } => p.seed !== null)
      .map(p => [p.playerId, p.seed]),
  );

  // Loop. Cap iterations as a safety net against infinite loops if
  // advance.ts ever fails to mark a match completed.
  for (let iteration = 0; iteration < 1000; iteration++) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tournaments/${tournamentId}/next-matches`,
      headers: { authorization: `Bearer ${organizerToken}` },
    });
    if (res.statusCode !== 200) {
      throw new Error(`next-matches failed: ${res.statusCode} ${res.body}`);
    }
    const body = res.json() as {
      matches: Array<{
        id: string;
        player1Id: string;
        player2Id: string;
      }>;
    };
    if (body.matches.length === 0) return;

    for (const m of body.matches) {
      const override = overrides.get(pairKey(m.player1Id, m.player2Id));
      const result = override ?? defaultResult(m, seedById);

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tournaments/${tournamentId}/matches/${m.id}/result`,
        headers: { authorization: `Bearer ${organizerToken}` },
        payload: result,
      });
      if (patchRes.statusCode !== 200 && patchRes.statusCode !== 204) {
        throw new Error(
          `PATCH match result failed for ${m.id}: ${patchRes.statusCode} ${patchRes.body}`,
        );
      }
    }
  }
  throw new Error('playOutTournament: exceeded iteration cap (probable infinite loop)');
}

/**
 * Default rule: the player with the LOWER seed value wins 3:0.
 * Throws if either player lacks a seed (shouldn't happen post-prepare).
 */
function defaultResult(
  match: { player1Id: string; player2Id: string },
  seedById: Map<string, number>,
): ResultOverride {
  const s1 = seedById.get(match.player1Id);
  const s2 = seedById.get(match.player2Id);
  if (s1 === undefined || s2 === undefined) {
    throw new Error(
      `defaultResult: missing seed for ${match.player1Id}=${s1} or ${match.player2Id}=${s2}`,
    );
  }
  const winnerId = s1 < s2 ? match.player1Id : match.player2Id;
  const setsPlayer1 = winnerId === match.player1Id ? 3 : 0;
  const setsPlayer2 = winnerId === match.player1Id ? 0 : 3;
  return { winnerId, setsPlayer1, setsPlayer2 };
}
