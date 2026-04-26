import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupIntegrationApp,
  teardownIntegrationApp,
  truncateTestData,
  type IntegrationAppHandle,
} from './__test-utils__/setup';
import { createPlayer, createTournament, addParticipants } from './__test-utils__/factories';
import { playOutTournament } from './__test-utils__/play-out';

let h: IntegrationAppHandle;

beforeAll(async () => { h = await setupIntegrationApp(); });
afterAll(async () => { await teardownIntegrationApp(h); });
beforeEach(async () => { await truncateTestData(h.prisma); });

describe('Tournament lifecycle integration', () => {
  it('Test 8: rewind + re-prepare with different format', async () => {
    const players = await Promise.all(
      Array.from({ length: 8 }, (_, i) => createPlayer(h.prisma, h.tokenService, { rating: 2000 - i * 50 })),
    );
    const { tournamentId } = await createTournament(h.prisma, { organizerId: h.organizerId });
    await addParticipants(h.app, h.organizerToken, tournamentId, players.map(p => p.playerId));

    // 1. PREPARE as round_robin
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/prepare`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
      payload: { format: 'round_robin' },
    }).then(r => expect(r.statusCode).toBe(201));

    const afterFirstPrepare = await h.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
    });
    expect(afterFirstPrepare.format).toBe('round_robin');
    expect(afterFirstPrepare.bracketShape).toBeNull();
    expect(afterFirstPrepare.status).toBe('prepared');
    const rrMatches = await h.prisma.match.findMany({ where: { tournamentId } });
    expect(rrMatches.length).toBe(28);  // C(8,2)

    // 2. REWIND
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/rewind`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
    }).then(r => expect(r.statusCode).toBe(201));

    const afterRewind = await h.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
    });
    expect(afterRewind.status).toBe('open');
    expect(afterRewind.format).toBeNull();
    expect(afterRewind.bracketShape).toBeNull();
    expect(afterRewind.groupSize).toBeNull();
    const afterRewindMatches = await h.prisma.match.findMany({ where: { tournamentId } });
    expect(afterRewindMatches.length).toBe(0);
    const afterRewindParticipants = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId },
    });
    expect(afterRewindParticipants.every(p => p.seed === null)).toBe(true);
    expect(afterRewindParticipants.every(p => p.groupLetter === null)).toBe(true);
    expect(afterRewindParticipants.every(p => p.groupRank === null)).toBe(true);

    // 3. PREPARE as groups_playoff
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/prepare`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
      payload: { format: 'groups_playoff', groupSize: 4 },
    }).then(r => expect(r.statusCode).toBe(201));

    const afterSecondPrepare = await h.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
    });
    expect(afterSecondPrepare.format).toBe('groups_playoff');
    expect(afterSecondPrepare.groupSize).toBe(4);
    expect(afterSecondPrepare.status).toBe('prepared');
    const gpMatches = await h.prisma.match.findMany({ where: { tournamentId } });
    expect(gpMatches.length).toBe(12);  // 2 groups × 6

    // 4. START → PLAY → FINALIZE
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/start`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
    }).then(r => expect(r.statusCode).toBe(201));

    await playOutTournament(h.app, h.organizerToken, h.prisma, tournamentId);

    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/tournaments/${tournamentId}/finalize`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
    }).then(r => expect(r.statusCode).toBe(200));

    const final = await h.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(final.status).toBe('completed');
    expect(final.processed).toBe(true);

    // 12 group matches + 4 sub-bracket finals (G=2, no R1) = 16 total
    const finalMatches = await h.prisma.match.findMany({ where: { tournamentId } });
    expect(finalMatches.length).toBe(16);

    const participants = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      orderBy: { finalPosition: 'asc' },
    });
    expect(participants.map(p => p.finalPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const ratingChanges = await h.prisma.ratingChange.findMany({ where: { tournamentId } });
    expect(ratingChanges.length).toBe(8);

    expect(participants.every(p => p.seed !== null)).toBe(true);
  });

  it('Test 7: drop participant in prepared, group runs short', async () => {
    const players = await Promise.all(
      Array.from({ length: 8 }, (_, i) => createPlayer(h.prisma, h.tokenService, { rating: 2000 - i * 50 })),
    );
    const [P1, P2, P3, P4, P5, P6, P7, P8] = players;
    void P1; void P2; void P3; void P4; void P6; void P7; void P8;

    const { tournamentId } = await createTournament(h.prisma, { organizerId: h.organizerId });
    await addParticipants(h.app, h.organizerToken, tournamentId, players.map(p => p.playerId));

    // PREPARE — snake into A=[P1,P4,P5,P8], B=[P2,P3,P6,P7]
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/prepare`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
      payload: { format: 'groups_playoff', groupSize: 4 },
    }).then(r => expect(r.statusCode).toBe(201));

    // DROP P5 (group A) — soft delete in prepared state
    const dropRes = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/tournaments/${tournamentId}/participants/${P5.playerId}`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
    });
    expect(dropRes.statusCode).toBe(200);

    // Verify P5 has withdrawnAt set, scheduled matches involving P5 deleted
    const p5Row = await h.prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_playerId: { tournamentId, playerId: P5.playerId } },
    });
    expect(p5Row.withdrawnAt).not.toBeNull();
    const matchesAfterDrop = await h.prisma.match.findMany({
      where: {
        tournamentId,
        OR: [{ player1Id: P5.playerId }, { player2Id: P5.playerId }],
      },
    });
    expect(matchesAfterDrop.length).toBe(0);

    // START → PLAY → FINALIZE
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/start`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
    }).then(r => expect(r.statusCode).toBe(201));

    await playOutTournament(h.app, h.organizerToken, h.prisma, tournamentId);

    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/tournaments/${tournamentId}/finalize`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
    }).then(r => expect(r.statusCode).toBe(200));

    const t = await h.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(t.status).toBe('completed');

    const allMatches = await h.prisma.match.findMany({ where: { tournamentId } });
    // Group A active = 3 players (P1, P4, P8) → 3 RR matches
    // Group B unchanged → 6 RR matches
    // KO sub-brackets:
    //   rank-1 (P1, P2): final → 2 finalPositions
    //   rank-2 (P4, P3): final → 2
    //   rank-3 (P8, P6): final → 2
    //   rank-4: only P7 (group A has no rank-4) → SKIPPED per ≥2-entrants rule
    // → 3 KO finals
    expect(allMatches.length).toBe(12);

    const groupAMatches = allMatches.filter(m => m.groupLetter === 'A');
    const groupBMatches = allMatches.filter(m => m.groupLetter === 'B');
    expect(groupAMatches.length).toBe(3);
    expect(groupBMatches.length).toBe(6);

    // No match references P5
    const matchesWithP5 = allMatches.filter(m =>
      m.player1Id === P5.playerId || m.player2Id === P5.playerId);
    expect(matchesWithP5.length).toBe(0);

    // P5 finalPosition is null
    const p5Final = await h.prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_playerId: { tournamentId, playerId: P5.playerId } },
    });
    expect(p5Final.finalPosition).toBeNull();
    expect(p5Final.withdrawnAt).not.toBeNull();

    // 7 active participants get finalPosition 1..7. P7 gets 7 (lone-entrant rule).
    const activeParticipants = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId, withdrawnAt: null },
      orderBy: { finalPosition: 'asc' },
    });
    expect(activeParticipants.map(p => p.finalPosition)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const p7Final = activeParticipants.find(p => p.playerId === P7.playerId)!;
    expect(p7Final.finalPosition).toBe(7);

    // 7 RatingChange rows (P5 didn't play)
    const ratingChanges = await h.prisma.ratingChange.findMany({ where: { tournamentId } });
    expect(ratingChanges.length).toBe(7);
  });
});
