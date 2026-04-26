import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupIntegrationApp,
  teardownIntegrationApp,
  truncateTestData,
  type IntegrationAppHandle,
} from './__test-utils__/setup';
import { createPlayer, createTournament, addParticipants } from './__test-utils__/factories';
import { runFullLifecycle, playCasualMatch } from './__test-utils__/lifecycle';

let h: IntegrationAppHandle;

beforeAll(async () => { h = await setupIntegrationApp(); });
afterAll(async () => { await teardownIntegrationApp(h); });
beforeEach(async () => { await truncateTestData(h.prisma); });

describe('Multi-event tournament integration', () => {
  it('Test 10: casual matches between two tournaments compose ratings correctly', async () => {
    // 8 players, ALL non-provisional from the start (tournamentsPlayed=5) so
    // the casual-match proposer gate is satisfied without running 5
    // throwaway tournaments first.
    const players = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createPlayer(h.prisma, h.tokenService, {
          rating: 2000 - i * 50,
          tournamentsPlayed: 5,
        })),
    );
    const [P1, P2, P3, P4, P5, P6, P7, P8] = players;
    void P1; void P2; void P6; void P8;

    // ── TOURNAMENT A ───────────────────────────────────────────────────
    const a = await createTournament(h.prisma, { organizerId: h.organizerId });
    await addParticipants(h.app, h.organizerToken, a.tournamentId, players.map(p => p.playerId));
    await runFullLifecycle(h.app, h.organizerToken, h.prisma, a.tournamentId,
      { format: 'groups_playoff', groupSize: 4 });

    // Snapshot ratings after Tournament A.
    const ratingsAfterA = new Map<string, number>();
    for (const p of players) {
      const player = await h.prisma.player.findUniqueOrThrow({ where: { id: p.playerId } });
      ratingsAfterA.set(p.playerId, player.internalRating);
    }

    // ── INTER-EVENT CASUAL MATCHES ─────────────────────────────────────
    // Casual 1: P3 proposes vs P5; P5 wins 3:1 (upset — P5 had a lower seed).
    await playCasualMatch(h.app, h.prisma, {
      proposerToken: P3.accessToken,
      opponentToken: P5.accessToken,
      opponentPlayerId: P5.playerId,
      winnerPlayerId: P5.playerId,
      setsPlayer1: 1,
      setsPlayer2: 3,
    });

    // Casual 2: P4 proposes vs P7; P4 wins 3:0 (expected by seed order).
    await playCasualMatch(h.app, h.prisma, {
      proposerToken: P4.accessToken,
      opponentToken: P7.accessToken,
      opponentPlayerId: P7.playerId,
      winnerPlayerId: P4.playerId,
      setsPlayer1: 3,
      setsPlayer2: 0,
    });

    // Snapshot ratings after casuals.
    const ratingsAfterCasuals = new Map<string, number>();
    for (const p of players) {
      const player = await h.prisma.player.findUniqueOrThrow({ where: { id: p.playerId } });
      ratingsAfterCasuals.set(p.playerId, player.internalRating);
    }

    // The 4 players involved in casuals saw their ratings move.
    expect(ratingsAfterCasuals.get(P3.playerId)).not.toBe(ratingsAfterA.get(P3.playerId));
    expect(ratingsAfterCasuals.get(P5.playerId)).not.toBe(ratingsAfterA.get(P5.playerId));
    expect(ratingsAfterCasuals.get(P4.playerId)).not.toBe(ratingsAfterA.get(P4.playerId));
    expect(ratingsAfterCasuals.get(P7.playerId)).not.toBe(ratingsAfterA.get(P7.playerId));

    // Players not in any casual: rating unchanged.
    for (const p of [P1, P2, P6, P8]) {
      expect(ratingsAfterCasuals.get(p.playerId)).toBe(ratingsAfterA.get(p.playerId));
    }

    // 4 RatingChange rows from casuals (2 matches × 2 players), all with
    // changeType='casual' and tournamentId=null.
    const casualChanges = await h.prisma.ratingChange.findMany({
      where: { tournamentId: null, changeType: 'casual' },
    });
    expect(casualChanges.length).toBe(4);

    // tournamentsPlayed must NOT increment for casual matches.
    for (const p of players) {
      const player = await h.prisma.player.findUniqueOrThrow({ where: { id: p.playerId } });
      expect(player.tournamentsPlayed).toBe(6);   // 5 initial + 1 from Tournament A
    }

    // ── TOURNAMENT B ───────────────────────────────────────────────────
    const b = await createTournament(h.prisma, { organizerId: h.organizerId });
    await addParticipants(h.app, h.organizerToken, b.tournamentId, players.map(p => p.playerId));
    await runFullLifecycle(h.app, h.organizerToken, h.prisma, b.tournamentId,
      { format: 'groups_playoff', groupSize: 4 });

    // ── CROWN-JEWEL ASSERTIONS ─────────────────────────────────────────
    // 1. Tournament B's seeds reflect the post-casual ratings.
    const bParticipants = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId: b.tournamentId },
    });
    const expectedSeedOrder = [...players]
      .map(p => ({ playerId: p.playerId, rating: ratingsAfterCasuals.get(p.playerId)! }))
      .sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return a.playerId.localeCompare(b.playerId);
      })
      .map(x => x.playerId);
    const actualSeedOrder = [...bParticipants]
      .filter(p => p.seed !== null)
      .sort((a, b) => a.seed! - b.seed!)
      .map(p => p.playerId);
    expect(actualSeedOrder).toEqual(expectedSeedOrder);

    // 2. Tournament B RatingChanges' ratingBefore equals post-casual rating
    //    (NOT post-Tournament-A rating).
    const bChanges = await h.prisma.ratingChange.findMany({
      where: { tournamentId: b.tournamentId },
    });
    expect(bChanges.length).toBe(8);
    for (const rc of bChanges) {
      const expectedBefore = ratingsAfterCasuals.get(rc.playerId)!;
      expect(rc.ratingBefore).toBe(expectedBefore);
    }

    // 3. Total RatingChange row count: 8 (Tournament A) + 4 (casuals) +
    //    8 (Tournament B) = 20.
    const allChanges = await h.prisma.ratingChange.findMany({});
    expect(allChanges.length).toBe(20);
  });

  it('Test 11: 8 players × 3 tournaments — RD shrinks, provisional respects threshold', async () => {
    // Factory defaults: tournamentsPlayed: 0, rd: 350, provisional: true.
    const players = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createPlayer(h.prisma, h.tokenService, { rating: 2000 - i * 50 })),
    );

    // 3 tournaments back-to-back, alternating formats to exercise both code paths.
    const formats: Array<{ format: 'round_robin' | 'groups_playoff'; groupSize?: number }> = [
      { format: 'round_robin' },
      { format: 'groups_playoff', groupSize: 4 },
      { format: 'round_robin' },
    ];

    const rdSnapshots: Array<Map<string, number>> = [];

    for (let i = 0; i < formats.length; i++) {
      const { tournamentId } = await createTournament(h.prisma, { organizerId: h.organizerId });
      await addParticipants(h.app, h.organizerToken, tournamentId, players.map(p => p.playerId));
      await runFullLifecycle(h.app, h.organizerToken, h.prisma, tournamentId, formats[i]);

      const snapshot = new Map<string, number>();
      for (const p of players) {
        const player = await h.prisma.player.findUniqueOrThrow({ where: { id: p.playerId } });
        snapshot.set(p.playerId, player.rd);
      }
      rdSnapshots.push(snapshot);
    }

    // 1. tournamentsPlayed = 3 for every player.
    for (const p of players) {
      const player = await h.prisma.player.findUniqueOrThrow({ where: { id: p.playerId } });
      expect(player.tournamentsPlayed).toBe(3);
    }

    // 2. provisional stays TRUE — 3 < 5 threshold (the rating-job fix).
    for (const p of players) {
      const player = await h.prisma.player.findUniqueOrThrow({ where: { id: p.playerId } });
      expect(player.provisional).toBe(true);
    }

    // 3. RD shrinks (or holds) monotonically per player across the 3 tournaments.
    for (const p of players) {
      const r1 = rdSnapshots[0].get(p.playerId)!;
      const r2 = rdSnapshots[1].get(p.playerId)!;
      const r3 = rdSnapshots[2].get(p.playerId)!;
      expect(r1).toBeLessThan(350);
      expect(r2).toBeLessThanOrEqual(r1);
      expect(r3).toBeLessThanOrEqual(r2);
    }

    // 4. RatingChange row count: 8 players × 3 tournaments = 24.
    const allChanges = await h.prisma.ratingChange.findMany({});
    expect(allChanges.length).toBe(24);

    // 5. Per-player chain integrity: each player's 3 RatingChange rows form
    //    an unbroken ratingBefore[i+1] === ratingAfter[i] chain.
    for (const p of players) {
      const chain = await h.prisma.ratingChange.findMany({
        where: { playerId: p.playerId },
        orderBy: { createdAt: 'asc' },
      });
      expect(chain.length).toBe(3);
      expect(chain[1].ratingBefore).toBe(chain[0].ratingAfter);
      expect(chain[2].ratingBefore).toBe(chain[1].ratingAfter);
    }
  });
});
