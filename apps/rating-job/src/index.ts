import { PrismaClient, Prisma } from '@prisma/client';
import { calculateGlicko, toDisplayRating, MatchInput } from '@tt-rating/core';

type MinimalMatch = {
  player1Id: string;
  player2Id: string;
  winnerId: string | null;
  matchWeight: number;
};

export function buildGlickoInputs(
  playerId: string,
  matches: MinimalMatch[],
  participantMap: Map<string, { ratingBefore: number; rdBefore: number }>,
): MatchInput[] {
  return matches
    .filter((m) => m.player1Id === playerId || m.player2Id === playerId)
    .map((match) => {
      const opponentId =
        match.player1Id === playerId ? match.player2Id : match.player1Id;
      const opponent = participantMap.get(opponentId);
      if (!opponent) {
        throw new Error(`Participant data missing for player ${opponentId}`);
      }
      return {
        opponentRating: opponent.ratingBefore,
        opponentRD: opponent.rdBefore,
        score: match.winnerId === playerId ? 1 : 0,
        matchWeight: match.matchWeight,
      };
    });
}

/**
 * Recompute ratings for a single tournament. Exported so it can be driven
 * either by the standalone CLI entry-point at the bottom of this file (when
 * the job runs as its own process — Cloud Run, cron, etc.) or by the API's
 * `InProcessRatingJobTrigger`, which calls this directly with its own Prisma
 * client.
 *
 * Idempotent by design: exits early if `tournament.processed` is already
 * true, so re-triggers are safe.
 */
export async function processTournament(
  tournamentId: string,
  prisma: PrismaClient,
): Promise<void> {
  console.log(`Starting rating job for tournament: ${tournamentId}`);

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      participants: true,
      matches: { where: { status: 'completed' } },
    },
  });

  if (!tournament) {
    throw new Error(`Tournament ${tournamentId} not found`);
  }

  if (tournament.processed) {
    console.log('Tournament already processed — exiting (idempotent)');
    return;
  }

  const participantMap = new Map<string, { ratingBefore: number; rdBefore: number }>(
    tournament.participants.map((p: { playerId: string; ratingBefore: number; rdBefore: number }) => [
      p.playerId,
      { ratingBefore: p.ratingBefore, rdBefore: p.rdBefore },
    ]),
  );

  const FORMULA_VERSION = '1.0.0';
  const coefficients = { c: 63.2, scale: 0.6, offset: 500, Q: 'log(10)/400' };

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const participant of tournament.participants) {
      const inputs = buildGlickoInputs(
        participant.playerId,
        tournament.matches,
        participantMap,
      );

      const { newRating, newRD } = calculateGlicko(
        participant.ratingBefore,
        participant.rdBefore,
        inputs,
      );

      const ratingDeltaDisplay =
        toDisplayRating(newRating) - toDisplayRating(participant.ratingBefore);

      await tx.player.update({
        where: { id: participant.playerId },
        data: {
          internalRating: newRating,
          rd: newRD,
          tournamentsPlayed: { increment: 1 },
          // Provisional = false after 3+ tournaments
          provisional: { set: false },
        },
      });

      await tx.tournamentParticipant.update({
        where: {
          tournamentId_playerId: {
            tournamentId,
            playerId: participant.playerId,
          },
        },
        data: { ratingAfter: newRating, rdAfter: newRD, ratingDeltaDisplay },
      });

      await tx.ratingChange.create({
        data: {
          playerId: participant.playerId,
          tournamentId,
          ratingBefore: participant.ratingBefore,
          ratingAfter: newRating,
          rdBefore: participant.rdBefore,
          rdAfter: newRD,
          changeType: 'tournament',
          formulaVersion: FORMULA_VERSION,
          coefficientsSnapshot: coefficients,
        },
      });

      // Weekly rating snapshot (upsert so re-runs don't duplicate)
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      await tx.ratingSnapshot.upsert({
        where: {
          playerId_snapshotDate: {
            playerId: participant.playerId,
            snapshotDate: today,
          },
        },
        create: {
          playerId: participant.playerId,
          snapshotDate: today,
          rating: newRating,
          rd: newRD,
        },
        update: { rating: newRating, rd: newRD },
      });
    }

    await tx.tournament.update({
      where: { id: tournamentId },
      data: { processed: true },
    });
  });

  // Refresh leaderboard outside transaction — CONCURRENTLY doesn't require exclusive lock
  await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard`;

  console.log(`Rating job complete for tournament: ${tournamentId}`);
}

async function main() {
  const tournamentId = process.env.TOURNAMENT_ID;
  if (!tournamentId) {
    throw new Error('TOURNAMENT_ID environment variable is required');
  }

  // The CLI entry-point owns its own Prisma client; `processTournament`
  // leaves lifecycle to the caller so in-process triggers can share the
  // API's already-connected client without flipping it into disconnect.
  const prisma = new PrismaClient();
  try {
    await processTournament(tournamentId, prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (!process.env.VITEST) {
  main().catch((e) => {
    console.error('Rating job failed:', e);
    process.exit(1);
  });
}
