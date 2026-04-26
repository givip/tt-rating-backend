import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupIntegrationApp,
  teardownIntegrationApp,
  truncateTestData,
  type IntegrationAppHandle,
} from './__test-utils__/setup';
import { createPlayer, createTournament, addParticipants } from './__test-utils__/factories';
import { playOutTournament, pairKey, type ResultOverride } from './__test-utils__/play-out';

let h: IntegrationAppHandle;

beforeAll(async () => { h = await setupIntegrationApp(); });
afterAll(async () => { await teardownIntegrationApp(h); });
beforeEach(async () => { await truncateTestData(h.prisma); });

/**
 * Helper that drives the standard lifecycle from prepare to finalize.
 * Used by every test in this file.
 */
async function runFullLifecycle(
  tournamentId: string,
  prepareBody: Record<string, unknown>,
  overrides?: Map<string, ResultOverride>,
): Promise<void> {
  const prep = await h.app.inject({
    method: 'POST',
    url: `/api/v1/tournaments/${tournamentId}/prepare`,
    headers: { authorization: `Bearer ${h.organizerToken}` },
    payload: prepareBody,
  });
  expect(prep.statusCode).toBe(201);

  const start = await h.app.inject({
    method: 'POST',
    url: `/api/v1/tournaments/${tournamentId}/start`,
    headers: { authorization: `Bearer ${h.organizerToken}` },
  });
  expect(start.statusCode).toBe(201);

  await playOutTournament(h.app, h.organizerToken, h.prisma, tournamentId, { overrides });

  const fin = await h.app.inject({
    method: 'PATCH',
    url: `/api/v1/tournaments/${tournamentId}/finalize`,
    headers: { authorization: `Bearer ${h.organizerToken}` },
  });
  expect(fin.statusCode).toBe(200);
}

describe('Groups+playoff tournament integration', () => {
  it('Test 3: GP N=16 gs=4 — clean case', async () => {
    const players = await Promise.all(
      Array.from({ length: 16 }, (_, i) => createPlayer(h.prisma, { rating: 2000 - i * 50 })),
    );
    const { tournamentId } = await createTournament(h.prisma, { organizerId: h.organizerId });
    await addParticipants(h.app, h.organizerToken, tournamentId, players.map(p => p.playerId));

    await runFullLifecycle(tournamentId, { format: 'groups_playoff', groupSize: 4 });

    const t = await h.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(t.status).toBe('completed');
    expect(t.processed).toBe(true);
    expect(t.format).toBe('groups_playoff');

    const matches = await h.prisma.match.findMany({ where: { tournamentId } });
    expect(matches.length).toBe(36);  // 24 group + 12 KO

    const groupMatches = matches.filter(m => m.groupLetter !== null);
    const koMatches = matches.filter(m => m.bracketLabel !== null);
    expect(groupMatches.length).toBe(24);
    expect(koMatches.length).toBe(12);

    const shape = t.bracketShape as { subBrackets: Array<{ size: number; rounds: unknown[] }> };
    expect(shape.subBrackets).toHaveLength(4);
    for (const sb of shape.subBrackets) {
      expect(sb.size).toBe(4);
      expect(sb.rounds).toHaveLength(2);
    }

    // Snake seeding: group A = P1, P8, P9, P16
    const groupA = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId, groupLetter: 'A' },
      orderBy: { seed: 'asc' },
    });
    expect(groupA.map(p => p.seed)).toEqual([1, 8, 9, 16]);

    const participants = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      orderBy: { finalPosition: 'asc' },
    });
    expect(participants.map(p => p.finalPosition)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );

    const p1 = participants.find(p => p.playerId === players[0].playerId)!;
    const p16 = participants.find(p => p.playerId === players[15].playerId)!;
    expect(p1.finalPosition).toBe(1);
    expect(p16.finalPosition).toBe(16);

    const ratingChanges = await h.prisma.ratingChange.findMany({ where: { tournamentId } });
    expect(ratingChanges.length).toBe(16);
  });
});
