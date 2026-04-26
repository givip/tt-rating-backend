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

beforeAll(async () => {
  h = await setupIntegrationApp();
});

afterAll(async () => {
  await teardownIntegrationApp(h);
});

beforeEach(async () => {
  await truncateTestData(h.prisma);
});

describe('Round-robin tournament integration', () => {
  it('Test 1: RR N=4 — full lifecycle, ratings update', async () => {
    // SETUP: 4 players, deterministic ratings.
    const p1 = await createPlayer(h.prisma, h.tokenService, { rating: 2000 });
    const p2 = await createPlayer(h.prisma, h.tokenService, { rating: 1900 });
    const p3 = await createPlayer(h.prisma, h.tokenService, { rating: 1800 });
    const p4 = await createPlayer(h.prisma, h.tokenService, { rating: 1700 });

    const { tournamentId } = await createTournament(h.prisma, {
      organizerId: h.organizerId,
    });
    await addParticipants(h.app, h.organizerToken, tournamentId,
      [p1.playerId, p2.playerId, p3.playerId, p4.playerId]);

    // PREPARE
    const prepRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/prepare`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
      payload: { format: 'round_robin' },
    });
    expect(prepRes.statusCode).toBe(201);

    // START
    const startRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/start`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
    });
    expect(startRes.statusCode).toBe(201);

    // PLAY OUT (default rule: top seed wins 3:0)
    await playOutTournament(h.app, h.organizerToken, h.prisma, tournamentId);

    // FINALIZE
    const finRes = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/tournaments/${tournamentId}/finalize`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
    });
    expect(finRes.statusCode).toBe(200);

    // ASSERTIONS
    // (A) Lifecycle invariants
    const t = await h.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(t.status).toBe('completed');
    expect(t.processed).toBe(true);

    const matches = await h.prisma.match.findMany({ where: { tournamentId } });
    expect(matches.every(m => m.status === 'completed')).toBe(true);

    const participants = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId, withdrawnAt: null },
    });
    const positions = participants.map(p => p.finalPosition).sort((a, b) => a! - b!);
    expect(positions).toEqual([1, 2, 3, 4]);

    // (B) Match graph
    expect(matches.length).toBe(6);
    expect(matches.every(m => m.groupLetter === null && m.bracketLabel === null)).toBe(true);
    const rounds = new Set(matches.map(m => m.round));
    expect([...rounds].sort()).toEqual([1, 2, 3]);

    // (C) Rating updates
    const ratingChanges = await h.prisma.ratingChange.findMany({ where: { tournamentId } });
    expect(ratingChanges.length).toBe(4);
    expect(ratingChanges.every(rc => rc.changeType === 'tournament')).toBe(true);
    expect(ratingChanges.every(rc => rc.formulaVersion === '1.0.0')).toBe(true);
    expect(ratingChanges.every(rc => rc.rdAfter < rc.rdBefore)).toBe(true);

    // (E) Specific outcomes
    const finalP1 = participants.find(p => p.playerId === p1.playerId)!;
    const finalP4 = participants.find(p => p.playerId === p4.playerId)!;
    expect(finalP1.finalPosition).toBe(1);
    expect(finalP4.finalPosition).toBe(4);

    const playerP1 = await h.prisma.player.findUniqueOrThrow({ where: { id: p1.playerId } });
    const playerP4 = await h.prisma.player.findUniqueOrThrow({ where: { id: p4.playerId } });
    expect(playerP1.internalRating).toBeGreaterThan(2000);
    expect(playerP4.internalRating).toBeLessThan(1700);
  });

  it('Test 2: RR N=7 — Berger odd-N bye handling', async () => {
    const players = await Promise.all(
      [2100, 2000, 1900, 1800, 1700, 1600, 1500].map(rating =>
        createPlayer(h.prisma, h.tokenService, { rating })),
    );

    const { tournamentId } = await createTournament(h.prisma, { organizerId: h.organizerId });
    await addParticipants(h.app, h.organizerToken, tournamentId, players.map(p => p.playerId));

    await h.app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/prepare`,
      headers: { authorization: `Bearer ${h.organizerToken}` },
      payload: { format: 'round_robin' },
    }).then(r => expect(r.statusCode).toBe(201));

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

    const matches = await h.prisma.match.findMany({ where: { tournamentId } });
    expect(matches.length).toBe(21);

    const roundCounts = new Map<number, number>();
    for (const m of matches) {
      roundCounts.set(m.round, (roundCounts.get(m.round) ?? 0) + 1);
    }
    expect([...roundCounts.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const count of roundCounts.values()) {
      expect(count).toBe(3);
    }

    for (const p of players) {
      const playerMatches = matches.filter(m =>
        m.player1Id === p.playerId || m.player2Id === p.playerId);
      expect(playerMatches.length).toBe(6);
    }

    const participants = await h.prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      orderBy: { finalPosition: 'asc' },
    });
    expect(participants.length).toBe(7);
    expect(participants.map(p => p.finalPosition)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(participants[0].playerId).toBe(players[0].playerId);
    expect(participants[6].playerId).toBe(players[6].playerId);

    const ratingChanges = await h.prisma.ratingChange.findMany({ where: { tournamentId } });
    expect(ratingChanges.length).toBe(7);
  });
});
