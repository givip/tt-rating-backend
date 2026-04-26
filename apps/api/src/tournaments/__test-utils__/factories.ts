import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@tt-rating/db/generated';

let playerCounter = 0;

/**
 * Creates a User row + Player row directly via Prisma. Defaults: rating 1500,
 * RD 350, gender 'M'. Provisional + tournamentsPlayed defaults from schema.
 */
export async function createPlayer(
  prisma: PrismaClient,
  opts: { rating?: number; firstNameEn?: string; lastNameEn?: string } = {},
): Promise<{ playerId: string; userId: string }> {
  const userId = randomUUID();
  const playerId = randomUUID();
  const idx = ++playerCounter;
  const firstNameEn = opts.firstNameEn ?? `First${idx}`;
  const lastNameEn = opts.lastNameEn ?? `Last${idx}`;

  await prisma.user.create({
    data: { id: userId, role: 'player', phone: `+1555000${String(idx).padStart(4, '0')}` },
  });
  await prisma.player.create({
    data: {
      id: playerId,
      userId,
      firstNameKa: firstNameEn,
      lastNameKa: lastNameEn,
      firstNameEn,
      lastNameEn,
      gender: 'M',
      internalRating: opts.rating ?? 1500,
      rd: 350,
    },
  });
  return { playerId, userId };
}

/**
 * Creates a tournament directly via Prisma (skipping the create endpoint to
 * stay format-agnostic). Default status is 'open' so prepare() can run
 * immediately.
 */
export async function createTournament(
  prisma: PrismaClient,
  opts: {
    organizerId: string;
    numberOfTables?: number;
    matchFormat?: 'bo3' | 'bo5' | 'bo7';
  },
): Promise<{ tournamentId: string }> {
  const tournamentId = randomUUID();
  await prisma.tournament.create({
    data: {
      id: tournamentId,
      title: `Test Tournament ${tournamentId.slice(0, 8)}`,
      organizerId: opts.organizerId,
      city: 'Tbilisi',
      startsAt: new Date(),
      status: 'open',
      format: null,
      matchFormat: opts.matchFormat ?? 'bo5',
      numberOfTables: opts.numberOfTables ?? 4,
    },
  });
  return { tournamentId };
}

/**
 * Adds participants by calling `POST /api/v1/tournaments/:id/participants`
 * for each. Uses the organizer's JWT. Asserts every call returns 201.
 */
export async function addParticipants(
  app: NestFastifyApplication,
  organizerToken: string,
  tournamentId: string,
  playerIds: string[],
): Promise<void> {
  for (const playerId of playerIds) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/participants`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: { playerId },
    });
    if (res.statusCode !== 201) {
      throw new Error(
        `addParticipants failed for ${playerId}: ${res.statusCode} ${res.body}`,
      );
    }
  }
}
