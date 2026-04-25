import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';

import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { PrismaService } from '../common/prisma.service';
import { RATING_JOB_TRIGGER } from '../rating/rating-job-trigger.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TOKEN_CONFIG_SERVICE, TokenService } from '../auth/token.service';

// Vitest's esbuild transformer strips TypeScript's `design:paramtypes` output
// that Nest's DI normally reads from `emitDecoratorMetadata`. Re-attach it by
// hand for the classes this test instantiates via Nest, matching each
// constructor's real parameter order. This is cheaper and more contained than
// wiring up an SWC-based transformer just for one smoke test.
Reflect.defineMetadata(
  'design:paramtypes',
  [PrismaService, JwtService, Object],
  TokenService,
);
Reflect.defineMetadata(
  'design:paramtypes',
  // Second constructor param is `@Inject(RATING_JOB_TRIGGER)` — Nest reads
  // that explicit token first, so the design-type slot just needs *some*
  // constructor function. `Object` satisfies that.
  [PrismaService, Object],
  TournamentsService,
);
Reflect.defineMetadata(
  'design:paramtypes',
  [TournamentsService],
  TournamentsController,
);
Reflect.defineMetadata('design:paramtypes', [TokenService], JwtAuthGuard);
Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard);

/**
 * Phase 2 end-to-end smoke test. Wires the real TournamentsController through
 * the real JwtAuthGuard + RolesGuard and a real TokenService, with Prisma and
 * Cloud Run stubbed out. This is the test called out in
 * `docs/plans/2026-04-23-rating-system-roadmap.md` Task 2.6 — it catches the
 * things unit tests cannot: guard wiring, DI order, the
 * controller → service → ownership check → rating gate chain, and that the
 * bearer extracted by JwtAuthGuard is the organizerId that reaches the service.
 */

const mockPrisma: any = {
  tournament: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  tournamentParticipant: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  player: { findUnique: vi.fn() },
  refreshToken: { create: vi.fn(), updateMany: vi.fn() },
  match: {
    create: vi.fn(),
    createMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
  // `prepare()` wraps its work in `prisma.$transaction(async (tx) => …)`. For
  // the smoke test we simply pass `mockPrisma` itself in as the `tx` so the
  // mocked methods on `tournament`, `tournamentParticipant`, `match` are the
  // ones the service calls inside the transaction.
  $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
};

const mockRatingJob = { trigger: vi.fn() };

const envConfig = {
  get: <T = string>(key: string): T | undefined => {
    const table: Record<string, string> = {
      AUTH_ACCESS_TTL: '15m',
      AUTH_REFRESH_TTL: '30d',
    };
    return table[key] as T | undefined;
  },
};

describe('Tournaments E2E (Phase 2 smoke)', () => {
  let app: NestFastifyApplication;
  let organizerAToken: string;
  let organizerBToken: string;
  let adminToken: string;
  let playerToken: string;

  beforeAll(async () => {
    mockPrisma.refreshToken.create.mockResolvedValue({});

    const mod = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'e2e-test-secret' })],
      controllers: [TournamentsController],
      providers: [
        TournamentsService,
        JwtAuthGuard,
        RolesGuard,
        TokenService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RATING_JOB_TRIGGER, useValue: mockRatingJob },
        { provide: TOKEN_CONFIG_SERVICE, useValue: envConfig },
      ],
    }).compile();

    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const tokens = app.get(TokenService);
    organizerAToken = (await tokens.issue('org-A', 'organizer')).accessToken;
    organizerBToken = (await tokens.issue('org-B', 'organizer')).accessToken;
    adminToken = (await tokens.issue('admin-1', 'admin')).accessToken;
    playerToken = (await tokens.issue('player-1', 'player')).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    for (const fn of [
      mockPrisma.tournament.create,
      mockPrisma.tournament.findUnique,
      mockPrisma.tournament.findMany,
      mockPrisma.tournament.update,
      mockPrisma.tournamentParticipant.create,
      mockPrisma.tournamentParticipant.findMany,
      mockPrisma.tournamentParticipant.findUnique,
      mockPrisma.tournamentParticipant.update,
      mockPrisma.tournamentParticipant.updateMany,
      mockPrisma.tournamentParticipant.delete,
      mockPrisma.player.findUnique,
      mockPrisma.match.create,
      mockPrisma.match.createMany,
      mockPrisma.match.findUnique,
      mockPrisma.match.findMany,
      mockPrisma.match.update,
      mockPrisma.match.deleteMany,
      mockPrisma.match.count,
      mockRatingJob.trigger,
    ]) {
      fn.mockReset();
    }
  });

  it('rejects POST /tournaments with no Authorization header (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tournaments',
      payload: { title: 'Spring Open' },
    });
    expect(res.statusCode).toBe(401);
    expect(mockPrisma.tournament.create).not.toHaveBeenCalled();
  });

  it('rejects POST /tournaments from a player role (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tournaments',
      headers: { authorization: `Bearer ${playerToken}` },
      payload: { title: 'Spring Open' },
    });
    expect(res.statusCode).toBe(403);
    expect(mockPrisma.tournament.create).not.toHaveBeenCalled();
  });

  it('POST /tournaments with organizer token uses req.user.userId as organizerId', async () => {
    mockPrisma.tournament.create.mockResolvedValue({ id: 't-new', organizerId: 'org-A' });
    const res = await app.inject({
      method: 'POST',
      url: '/tournaments',
      headers: { authorization: `Bearer ${organizerAToken}` },
      payload: { title: 'Spring Open', minRating: 1800 },
    });
    expect(res.statusCode).toBe(201);
    expect(mockPrisma.tournament.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Spring Open',
        minRating: 1800,
        organizerId: 'org-A',
      }),
    });
  });

  it('organizer B cannot add a participant to organizer A\'s tournament (403)', async () => {
    mockPrisma.tournament.findUnique.mockResolvedValue({
      id: 't-A',
      organizerId: 'org-A',
      minRating: null,
      maxRating: null,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/tournaments/t-A/participants',
      headers: { authorization: `Bearer ${organizerBToken}` },
      payload: { playerId: 'p1' },
    });
    expect(res.statusCode).toBe(403);
    expect(mockPrisma.tournamentParticipant.create).not.toHaveBeenCalled();
  });

  it('rejects a 1500-rated player on a minRating=1800 tournament (400)', async () => {
    mockPrisma.tournament.findUnique.mockResolvedValue({
      id: 't-A',
      organizerId: 'org-A',
      minRating: 1800,
      maxRating: null,
    });
    mockPrisma.player.findUnique.mockResolvedValue({
      id: 'p1',
      internalRating: 1500,
      rd: 120,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/tournaments/t-A/participants',
      headers: { authorization: `Bearer ${organizerAToken}` },
      payload: { playerId: 'p1' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/below min rating/i);
    expect(mockPrisma.tournamentParticipant.create).not.toHaveBeenCalled();
  });

  it('admin can add a participant to any organizer\'s tournament', async () => {
    mockPrisma.tournament.findUnique.mockResolvedValue({
      id: 't-A',
      organizerId: 'org-A',
      minRating: null,
      maxRating: null,
    });
    mockPrisma.player.findUnique.mockResolvedValue({
      id: 'p1',
      internalRating: 1600,
      rd: 120,
    });
    mockPrisma.tournamentParticipant.create.mockResolvedValue({
      tournamentId: 't-A',
      playerId: 'p1',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/tournaments/t-A/participants',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { playerId: 'p1' },
    });
    expect(res.statusCode).toBe(201);
    expect(mockPrisma.tournamentParticipant.create).toHaveBeenCalled();
  });

  describe('POST /tournaments/:id/matches', () => {
    const tournamentRecord = {
      id: 't-A',
      organizerId: 'org-A',
      processed: false,
      status: 'open' as const,
      matchFormat: 'bo5' as const,
      participants: [
        { playerId: '11111111-1111-1111-1111-111111111111' },
        { playerId: '22222222-2222-2222-2222-222222222222' },
      ],
    };
    const validPayload = {
      round: 1,
      player1Id: '11111111-1111-1111-1111-111111111111',
      player2Id: '22222222-2222-2222-2222-222222222222',
      winnerId: '11111111-1111-1111-1111-111111111111',
      setsPlayer1: 3,
      setsPlayer2: 0,
    };

    it('rejects with no Authorization header (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tournaments/t-A/matches',
        payload: validPayload,
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a player role (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tournaments/t-A/matches',
        headers: { authorization: `Bearer ${playerToken}` },
        payload: validPayload,
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects malformed body with 400 (zod)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tournaments/t-A/matches',
        headers: { authorization: `Bearer ${organizerAToken}` },
        payload: { round: 1, player1Id: 'not-a-uuid', player2Id: 'also-not' },
      });
      expect(res.statusCode).toBe(400);
      expect(mockPrisma.match.create).not.toHaveBeenCalled();
    });

    it('organizer B cannot create matches in A\'s tournament (403)', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(tournamentRecord);
      const res = await app.inject({
        method: 'POST',
        url: '/tournaments/t-A/matches',
        headers: { authorization: `Bearer ${organizerBToken}` },
        payload: validPayload,
      });
      expect(res.statusCode).toBe(403);
      expect(mockPrisma.match.create).not.toHaveBeenCalled();
    });

    it('organizer A can create a match in their tournament', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(tournamentRecord);
      mockPrisma.match.create.mockResolvedValue({ id: 'm-1' });
      const res = await app.inject({
        method: 'POST',
        url: '/tournaments/t-A/matches',
        headers: { authorization: `Bearer ${organizerAToken}` },
        payload: validPayload,
      });
      expect(res.statusCode).toBe(201);
      expect(mockPrisma.match.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tournamentId: 't-A',
          player1Id: validPayload.player1Id,
          player2Id: validPayload.player2Id,
          winnerId: validPayload.winnerId,
          matchWeight: 1.0, // bo5 3:0
          enteredBy: 'org-A',
          status: 'completed',
        }),
      });
    });
  });

  describe('Tournament management v1 — happy path smoke', () => {
    // Convenience wrapper around `TokenService.issue` so the tests below read
    // closer to the documented `signTestToken({ userId, role })` shape.
    const signTestToken = async (input: { userId: string; role: string }) => {
      const tokens = app.get(TokenService);
      const issued = await tokens.issue(input.userId, input.role);
      return issued.accessToken;
    };

    it('round-robin: prepare → start → standings → next-matches', async () => {
      const tournamentId = '00000000-0000-0000-0000-000000000999';
      const organizerId = '00000000-0000-0000-0000-0000000000a1';
      const accessToken = await signTestToken({
        userId: organizerId,
        role: 'organizer',
      });

      // Tournament starts in `open`. After prepare() the service writes
      // `status: 'prepared'`, after start() it writes `in_progress`. We track
      // that mutable state in `currentStatus` and have `findUnique` reflect it
      // on every read so the chained calls observe a consistent timeline.
      let currentStatus = 'open';
      mockPrisma.tournament.findUnique.mockImplementation(({ where }: any) => {
        if (where.id !== tournamentId) return Promise.resolve(null);
        return Promise.resolve({
          id: tournamentId,
          status: currentStatus,
          organizerId,
          format: currentStatus === 'open' ? null : 'round_robin',
          numberOfTables: 4,
          matchFormat: 'bo5',
          groupSize: null,
          bracketShape: null,
          processed: false,
        });
      });
      mockPrisma.tournament.update.mockImplementation(({ data }: any) => {
        if (data.status) currentStatus = data.status;
        return Promise.resolve({ id: tournamentId, ...data });
      });
      mockPrisma.tournamentParticipant.findMany.mockResolvedValue([
        {
          tournamentId,
          playerId: 'p1',
          player: { internalRating: 2000 },
          withdrawnAt: null,
          seed: null,
          groupLetter: null,
          groupRank: null,
          finalPosition: null,
        },
        {
          tournamentId,
          playerId: 'p2',
          player: { internalRating: 1900 },
          withdrawnAt: null,
          seed: null,
          groupLetter: null,
          groupRank: null,
          finalPosition: null,
        },
        {
          tournamentId,
          playerId: 'p3',
          player: { internalRating: 1800 },
          withdrawnAt: null,
          seed: null,
          groupLetter: null,
          groupRank: null,
          finalPosition: null,
        },
        {
          tournamentId,
          playerId: 'p4',
          player: { internalRating: 1700 },
          withdrawnAt: null,
          seed: null,
          groupLetter: null,
          groupRank: null,
          finalPosition: null,
        },
      ]);
      mockPrisma.tournamentParticipant.update.mockResolvedValue({});
      mockPrisma.match.createMany.mockResolvedValue({ count: 6 });
      mockPrisma.match.findMany.mockResolvedValue([
        {
          id: 'm1',
          round: 1,
          player1Id: 'p1',
          player2Id: 'p4',
          status: 'scheduled',
          groupLetter: null,
          bracketLabel: null,
        },
        {
          id: 'm2',
          round: 1,
          player1Id: 'p2',
          player2Id: 'p3',
          status: 'scheduled',
          groupLetter: null,
          bracketLabel: null,
        },
      ]);

      // PREPARE
      const prepRes = await app.inject({
        method: 'POST',
        url: `/tournaments/${tournamentId}/prepare`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { format: 'round_robin' },
      });
      expect(prepRes.statusCode).toBe(201);

      // START
      const startRes = await app.inject({
        method: 'POST',
        url: `/tournaments/${tournamentId}/start`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(startRes.statusCode).toBe(201);

      // STANDINGS
      const standingsRes = await app.inject({
        method: 'GET',
        url: `/tournaments/${tournamentId}/standings`,
      });
      expect(standingsRes.statusCode).toBe(200);
      expect(standingsRes.json().format).toBe('round_robin');

      // NEXT-MATCHES
      const nextRes = await app.inject({
        method: 'GET',
        url: `/tournaments/${tournamentId}/next-matches?limit=2`,
      });
      expect(nextRes.statusCode).toBe(200);
      expect(nextRes.json().matches.length).toBeLessThanOrEqual(2);
    });

    it('rejects unauth on PATCH match result', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/tournaments/00000000-0000-0000-0000-000000000999/matches/m1/result`,
        payload: {
          winnerId: '00000000-0000-0000-0000-0000000000ff',
          setsPlayer1: 3,
          setsPlayer2: 1,
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects single_elim with 400', async () => {
      const tournamentId = '00000000-0000-0000-0000-000000000998';
      const accessToken = await signTestToken({
        userId: '00000000-0000-0000-0000-0000000000a1',
        role: 'organizer',
      });
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        status: 'open',
        organizerId: '00000000-0000-0000-0000-0000000000a1',
        processed: false,
      });
      mockPrisma.tournamentParticipant.findMany.mockResolvedValue([]);
      const res = await app.inject({
        method: 'POST',
        url: `/tournaments/${tournamentId}/prepare`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { format: 'single_elim' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/unsupported format/);
    });
  });
});
