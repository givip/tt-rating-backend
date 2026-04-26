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
      Array.from({ length: 16 }, (_, i) => createPlayer(h.prisma, h.tokenService, { rating: 2000 - i * 50 })),
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

  it('Test 4: GP N=12 gs=4 — sub-bracket bye for top seed', async () => {
    const players = await Promise.all(
      Array.from({ length: 12 }, (_, i) => createPlayer(h.prisma, h.tokenService, { rating: 2000 - i * 50 })),
    );
    const { tournamentId } = await createTournament(h.prisma, { organizerId: h.organizerId });
    await addParticipants(h.app, h.organizerToken, tournamentId, players.map(p => p.playerId));

    await runFullLifecycle(tournamentId, { format: 'groups_playoff', groupSize: 4 });

    const t = await h.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(t.status).toBe('completed');

    const matches = await h.prisma.match.findMany({ where: { tournamentId } });
    // 18 group + 4 sub-bracket R1 (1 real per sub-bracket; bye is implicit) + 4 finals = 26
    expect(matches.length).toBe(26);

    const groupMatches = matches.filter(m => m.groupLetter !== null);
    const koMatches = matches.filter(m => m.bracketLabel !== null);
    expect(groupMatches.length).toBe(18);
    expect(koMatches.length).toBe(8);

    // Each sub-bracket's R1 has only 1 Match row (the bye doesn't create one)
    const labels = ['places-1-to-3', 'places-4-to-6', 'places-7-to-9', 'places-10-to-12'];
    for (const label of labels) {
      const r1 = matches.filter(m => m.bracketLabel === label && m.round === 1);
      expect(r1.length).toBe(1);
    }

    // bracketShape's R1 has a pairing with right=null (the bye)
    const shape = t.bracketShape as {
      subBrackets: Array<{
        rounds: Array<{ pairings: Array<{ right: unknown }> }>;
      }>;
    };
    const r1Pairings = shape.subBrackets[0].rounds[0].pairings;
    const byePairing = r1Pairings.find(p => p.right === null);
    expect(byePairing).toBeDefined();

    const participants = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      orderBy: { finalPosition: 'asc' },
    });
    expect(participants.map(p => p.finalPosition)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
  });

  it('Test 5: GP N=15 gs=5 — uniform groups, gs=5', async () => {
    const players = await Promise.all(
      Array.from({ length: 15 }, (_, i) => createPlayer(h.prisma, h.tokenService, { rating: 2000 - i * 50 })),
    );
    const { tournamentId } = await createTournament(h.prisma, { organizerId: h.organizerId });
    await addParticipants(h.app, h.organizerToken, tournamentId, players.map(p => p.playerId));

    await runFullLifecycle(tournamentId, { format: 'groups_playoff', groupSize: 5 });

    const t = await h.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(t.status).toBe('completed');
    expect(t.groupSize).toBe(5);

    const matches = await h.prisma.match.findMany({ where: { tournamentId } });
    // 3 groups × 10 matches + 5 sub-brackets × (1 R1 + 1 final) = 30 + 10 = 40
    expect(matches.length).toBe(40);

    const groupMatches = matches.filter(m => m.groupLetter !== null);
    expect(groupMatches.length).toBe(30);

    // bracketShape has 5 sub-brackets (one per groupRank 1..5)
    const shape = t.bracketShape as { subBrackets: Array<{ size: number }> };
    expect(shape.subBrackets).toHaveLength(5);
    for (const sb of shape.subBrackets) {
      expect(sb.size).toBe(4);  // next pow2 of G=3 with bye
    }

    // 15 finalPositions
    const participants = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      orderBy: { finalPosition: 'asc' },
    });
    expect(participants.map(p => p.finalPosition)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );

    // P1 wins overall, P15 finishes last
    const p1 = participants.find(p => p.playerId === players[0].playerId)!;
    const p15 = participants.find(p => p.playerId === players[14].playerId)!;
    expect(p1.finalPosition).toBe(1);
    expect(p15.finalPosition).toBe(15);
  });

  it('Test 6: GP N=12 — scripted tiebreaker via RTTF cascade', async () => {
    // Same player layout as Test 4 — 12 players, snake A=[1,6,7,12], B=[2,5,8,11], C=[3,4,9,10]
    const players = await Promise.all(
      Array.from({ length: 12 }, (_, i) => createPlayer(h.prisma, h.tokenService, { rating: 2000 - i * 50 })),
    );
    const [P1, P2, P3, , , P6, P7, P8, P9, , , P12] = players;
    void P2; void P3; void P8; void P9;  // referenced by ID below; silence unused-var TS warnings

    const { tournamentId } = await createTournament(h.prisma, { organizerId: h.organizerId });
    await addParticipants(h.app, h.organizerToken, tournamentId, players.map(p => p.playerId));

    // PREPARE first so we can read the actual match-row orientations.
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/prepare`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
      payload: { format: 'groups_playoff', groupSize: 4 },
    }).then(r => expect(r.statusCode).toBe(201));

    // Build override map for Group A's 6 matches creating a 3-way tie at 2 wins each.
    // Encoded as canonical (winner, loser, winnerSets, loserSets); flipped to
    // setsPlayer1/setsPlayer2 below based on actual match-row player1 orientation.
    type ScriptedScore = { winnerId: string; winnerSets: number; loserSets: number };
    const scoreOf: Record<string, ScriptedScore> = {
      [pairKey(P1.playerId, P6.playerId)]:  { winnerId: P1.playerId,  winnerSets: 3, loserSets: 1 },
      [pairKey(P1.playerId, P7.playerId)]:  { winnerId: P7.playerId,  winnerSets: 3, loserSets: 0 },
      [pairKey(P1.playerId, P12.playerId)]: { winnerId: P1.playerId,  winnerSets: 3, loserSets: 0 },
      [pairKey(P6.playerId, P7.playerId)]:  { winnerId: P6.playerId,  winnerSets: 3, loserSets: 0 },
      [pairKey(P6.playerId, P12.playerId)]: { winnerId: P6.playerId,  winnerSets: 3, loserSets: 0 },
      [pairKey(P7.playerId, P12.playerId)]: { winnerId: P7.playerId,  winnerSets: 3, loserSets: 0 },
    };
    const overrides = new Map<string, ResultOverride>();
    const groupAMatches = await h.prisma.match.findMany({
      where: { tournamentId, groupLetter: 'A' },
    });
    for (const m of groupAMatches) {
      const k = pairKey(m.player1Id, m.player2Id);
      const s = scoreOf[k];
      if (!s) continue;
      const setsPlayer1 = s.winnerId === m.player1Id ? s.winnerSets : s.loserSets;
      const setsPlayer2 = s.winnerId === m.player1Id ? s.loserSets : s.winnerSets;
      overrides.set(k, { winnerId: s.winnerId, setsPlayer1, setsPlayer2 });
    }

    // START → PLAY → FINALIZE
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/start`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
    }).then(r => expect(r.statusCode).toBe(201));

    await playOutTournament(h.app, h.organizerToken, h.prisma, tournamentId, { overrides });

    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/tournaments/${tournamentId}/finalize`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
    }).then(r => expect(r.statusCode).toBe(200));

    // CROWN-JEWEL ASSERTIONS
    // Group A's groupRank ordering after RTTF cascade resolves the 3-way tie
    // at sets-ratio: P6 (4/3 ≈ 1.333) > P7 (1.0) > P1 (3/4 = 0.75); P12 last.
    const groupAFinal = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId, groupLetter: 'A' },
      orderBy: { groupRank: 'asc' },
    });
    expect(groupAFinal.map(p => p.playerId)).toEqual([
      P6.playerId, P7.playerId, P1.playerId, P12.playerId,
    ]);

    // bracketShape is built at prepare time with STATIC positional pairings:
    // group A → bracket-seed 1 (bye), B → 2, C → 3. The slot bindings don't
    // re-seed at advance time. So whoever wins group A inherits the bye slot.
    //
    // Rank-1 sub-bracket (places-1-to-3):
    //   - 1A = P6 (group A's tiebreaker winner) → bye to F
    //   - 1B = P2 vs 1C = P3 in R1 → P2 wins (lower seed)
    //   - F: P6 vs P2 → P2 wins (lower seed)
    //   - finalPositions: P2=1, P6=2, P3=3
    const finalP2 = await h.prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_playerId: { tournamentId, playerId: P2.playerId } },
    });
    const finalP6 = await h.prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_playerId: { tournamentId, playerId: P6.playerId } },
    });
    const finalP3 = await h.prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_playerId: { tournamentId, playerId: P3.playerId } },
    });
    expect(finalP2.finalPosition).toBe(1);
    expect(finalP6.finalPosition).toBe(2);
    expect(finalP3.finalPosition).toBe(3);

    // Rank-3 sub-bracket (places-7-to-9):
    //   - 3A = P1 (group A's 3rd via the upset cascade) → bye to F
    //   - 3B = P8 vs 3C = P9 in R1 → P8 wins
    //   - F: P1 vs P8 → P1 wins
    //   - finalPositions: P1=7, P8=8, P9=9
    const finalP1 = await h.prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_playerId: { tournamentId, playerId: P1.playerId } },
    });
    expect(finalP1.finalPosition).toBe(7);
  });
});
