import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';

import { CasualMatchesController } from './casual-matches.controller';
import { CasualMatchesService } from './casual-matches.service';
import { PrismaService } from '../common/prisma.service';
import { RATING_JOB_TRIGGER } from '../rating/rating-job-trigger.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TOKEN_CONFIG_SERVICE, TokenService } from '../auth/token.service';

// Vitest's esbuild transformer strips TypeScript's `design:paramtypes` output
// that Nest's DI reads when `emitDecoratorMetadata` is on. Re-attach it by
// hand for the classes this test instantiates via Nest, matching each
// constructor's real parameter order — mirrors `tournaments.e2e.test.ts`.
Reflect.defineMetadata(
  'design:paramtypes',
  [PrismaService, JwtService, Object],
  TokenService,
);
Reflect.defineMetadata(
  'design:paramtypes',
  // Second param is `@Inject(RATING_JOB_TRIGGER)` — Nest resolves that via the
  // explicit token, so the design-type slot just needs *some* constructor fn.
  [PrismaService, Object],
  CasualMatchesService,
);
Reflect.defineMetadata(
  'design:paramtypes',
  [CasualMatchesService],
  CasualMatchesController,
);
Reflect.defineMetadata('design:paramtypes', [TokenService], JwtAuthGuard);
Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard);

/**
 * End-to-end smoke test for the casual-matches controller. Wires the real
 * controller through the real JwtAuthGuard + RolesGuard + TokenService with
 * Prisma and the rating-job trigger stubbed. Covers auth, validation, the
 * propose → accept happy path (including that the rating trigger is fired
 * with the correct matchId), and the non-opponent accept guard.
 */

// Stable UUIDs shared between mocks and payloads so that
// `player.findUnique({ where: { id: BOB_ID } })` returns the same player that
// the proposer references in `opponentId` / `winnerId`.
const ALICE_ID = '11111111-1111-1111-1111-111111111111';
const BOB_ID = '22222222-2222-2222-2222-222222222222';

const mockPrisma: any = {
  player: { findUnique: vi.fn() },
  match: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  ratingConfig: { findUnique: vi.fn() },
  refreshToken: { create: vi.fn(), updateMany: vi.fn() },
};

const mockTrigger = { trigger: vi.fn() };

const envConfig = {
  get: <T = string>(key: string): T | undefined => {
    const table: Record<string, string> = {
      AUTH_ACCESS_TTL: '15m',
      AUTH_REFRESH_TTL: '30d',
    };
    return table[key] as T | undefined;
  },
};

describe('CasualMatches E2E (smoke)', () => {
  let app: NestFastifyApplication;
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    mockPrisma.refreshToken.create.mockResolvedValue({});

    const mod = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'e2e-test-secret' })],
      controllers: [CasualMatchesController],
      providers: [
        CasualMatchesService,
        JwtAuthGuard,
        RolesGuard,
        TokenService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RATING_JOB_TRIGGER, useValue: mockTrigger },
        { provide: TOKEN_CONFIG_SERVICE, useValue: envConfig },
      ],
    }).compile();

    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const tokens = app.get(TokenService);
    aliceToken = (await tokens.issue('u-alice', 'player')).accessToken;
    bobToken = (await tokens.issue('u-bob', 'player')).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    for (const fn of [
      mockPrisma.player.findUnique,
      mockPrisma.match.create,
      mockPrisma.match.findUnique,
      mockPrisma.match.findMany,
      mockPrisma.match.update,
      mockPrisma.match.updateMany,
      mockPrisma.match.delete,
      mockPrisma.match.deleteMany,
      mockPrisma.ratingConfig.findUnique,
      mockTrigger.trigger,
    ]) {
      fn.mockReset();
    }
  });

  it('rejects POST /casual-matches without token (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/casual-matches',
      payload: {
        opponentId: BOB_ID,
        winnerId: ALICE_ID,
        setsPlayer1: 3,
        setsPlayer2: 1,
      },
    });
    expect(res.statusCode).toBe(401);
    expect(mockPrisma.match.create).not.toHaveBeenCalled();
  });

  it('rejects malformed body (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/casual-matches',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { opponentId: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
    expect(mockPrisma.match.create).not.toHaveBeenCalled();
  });

  it('happy path: Alice proposes → Bob accepts → trigger called with matchId', async () => {
    // Propose phase — service reads proposer by userId, then opponent by id,
    // then the casual-weight multiplier from ratingConfig, then creates the
    // match. UUIDs are aligned so the `where: { id: BOB_ID }` lookup returns
    // the opponent that Alice's payload references.
    mockPrisma.player.findUnique.mockImplementation(({ where }: any) => {
      if (where.userId === 'u-alice') {
        return { id: ALICE_ID, userId: 'u-alice', tournamentsPlayed: 10 };
      }
      if (where.userId === 'u-bob') {
        return { id: BOB_ID, userId: 'u-bob', tournamentsPlayed: 6 };
      }
      if (where.id === BOB_ID) {
        return { id: BOB_ID, tournamentsPlayed: 6 };
      }
      if (where.id === ALICE_ID) {
        return { id: ALICE_ID, tournamentsPlayed: 10 };
      }
      return null;
    });
    mockPrisma.ratingConfig.findUnique.mockResolvedValue({
      key: 'casual_weight_multiplier',
      value: 0.3,
    });
    mockPrisma.match.create.mockResolvedValue({ id: 'm-1' });

    const propose = await app.inject({
      method: 'POST',
      url: '/casual-matches',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        opponentId: BOB_ID,
        winnerId: ALICE_ID,
        setsPlayer1: 3,
        setsPlayer2: 1,
      },
    });
    expect(propose.statusCode).toBe(201);
    expect(mockPrisma.match.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matchType: 'casual',
        proposerId: ALICE_ID,
        player1Id: ALICE_ID,
        player2Id: BOB_ID,
        winnerId: ALICE_ID,
        status: 'pending_opponent',
        enteredBy: 'u-alice',
      }),
    });

    // Accept phase — service reads the match, reads the caller's player row
    // (by userId), runs the atomic `updateMany`, fires the rating trigger,
    // then re-reads the confirmed match for the response.
    const pendingMatch = {
      id: 'm-1',
      matchType: 'casual',
      status: 'pending_opponent',
      player1Id: ALICE_ID,
      player2Id: BOB_ID,
      proposerId: ALICE_ID,
      expiresAt: new Date(Date.now() + 86400 * 1000),
    };
    const confirmedMatch = { ...pendingMatch, status: 'confirmed', confirmedAt: new Date() };
    mockPrisma.match.findUnique
      .mockResolvedValueOnce(pendingMatch) // initial lookup at start of accept()
      .mockResolvedValueOnce(confirmedMatch); // re-read after updateMany
    mockPrisma.match.updateMany.mockResolvedValue({ count: 1 });

    const accept = await app.inject({
      method: 'POST',
      url: '/casual-matches/m-1/accept',
      headers: { authorization: `Bearer ${bobToken}` },
    });
    expect(accept.statusCode).toBe(201);
    expect(mockPrisma.match.updateMany).toHaveBeenCalledWith({
      where: { id: 'm-1', status: 'pending_opponent' },
      data: expect.objectContaining({ status: 'confirmed' }),
    });
    expect(mockTrigger.trigger).toHaveBeenCalledWith({ matchId: 'm-1' });
  });

  it('rejects accept from non-opponent (400)', async () => {
    // Alice (the proposer) tries to accept her own match — service's
    // `caller.id !== match.player2Id` check should reject with 400.
    mockPrisma.match.findUnique.mockResolvedValue({
      id: 'm-1',
      matchType: 'casual',
      status: 'pending_opponent',
      player1Id: ALICE_ID,
      player2Id: BOB_ID,
      proposerId: ALICE_ID,
      expiresAt: new Date(Date.now() + 86400 * 1000),
    });
    mockPrisma.player.findUnique.mockImplementation(({ where }: any) => {
      if (where.userId === 'u-alice') {
        return { id: ALICE_ID, userId: 'u-alice' };
      }
      return null;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/casual-matches/m-1/accept',
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(mockPrisma.match.updateMany).not.toHaveBeenCalled();
    expect(mockTrigger.trigger).not.toHaveBeenCalled();
  });
});
