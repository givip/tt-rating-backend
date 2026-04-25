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

const mockPrisma = {
  tournament: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  tournamentParticipant: { create: vi.fn(), findMany: vi.fn() },
  player: { findUnique: vi.fn() },
  refreshToken: { create: vi.fn(), updateMany: vi.fn() },
  match: { create: vi.fn() },
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
      mockPrisma.player.findUnique,
      mockPrisma.match.create,
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
});
