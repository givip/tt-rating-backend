import { PrismaClient, Prisma } from '@tt-rating/db';
import { calculateGlicko, toDisplayRating, MatchInput } from '@tt-rating/core';

const FORMULA_VERSION = '1.0.0';
const FORMULA_COEFFICIENTS = { c: 63.2, scale: 0.6, offset: 500, Q: 'log(10)/400' };

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
          coefficientsSnapshot: FORMULA_COEFFICIENTS,
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

/**
 * Process a single casual match. Called on accept — the match has already
 * been validated and flipped to `confirmed` by the API. This job:
 *
 *  1. Acquires Postgres advisory locks on both player IDs (sorted order) so
 *     concurrent invocations for the same player serialize inside Postgres
 *     without lost updates.
 *  2. Re-reads both players' current rating/rd inside the transaction (values
 *     may have changed between confirm and job-start due to another match).
 *  3. Runs one Glicko step per player against their opponent.
 *  4. Writes two RatingChange rows (tournamentId = null, changeType = casual).
 *  5. Refreshes the leaderboard materialized view outside the transaction.
 *
 * On success, flips match.status from `confirmed` → `completed` inside the
 * same transaction, so retries become no-ops via the status guard.
 */
export async function processCasualMatch(
  matchId: string,
  prisma: PrismaClient,
): Promise<void> {
  console.log(`Starting casual-match rating job for ${matchId}`);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const match = await tx.match.findUnique({ where: { id: matchId } });
    if (!match) throw new Error(`Match ${matchId} not found`);
    if (match.matchType !== 'casual') {
      throw new Error(`Match ${matchId} is not a casual match`);
    }
    if (match.status !== 'confirmed') {
      throw new Error(
        `Match ${matchId} is not confirmed (status=${match.status})`,
      );
    }

    // Acquire advisory locks on both players in ascending UUID order so two
    // concurrent jobs sharing one player deadlock-free-serialize. hashtextextended
    // returns bigint; pg_advisory_xact_lock(bigint) is the single-arg overload.
    const [loId, hiId] =
      match.player1Id < match.player2Id
        ? [match.player1Id, match.player2Id]
        : [match.player2Id, match.player1Id];
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${loId}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hiId}, 0))`;

    const [p1, p2] = await Promise.all([
      tx.player.findUnique({ where: { id: match.player1Id } }),
      tx.player.findUnique({ where: { id: match.player2Id } }),
    ]);
    if (!p1 || !p2) throw new Error('Player missing after lock');

    for (const [self, opp] of [[p1, p2], [p2, p1]] as const) {
      const { newRating, newRD } = calculateGlicko(
        self.internalRating,
        self.rd,
        [
          {
            opponentRating: opp.internalRating,
            opponentRD: opp.rd,
            score: match.winnerId === self.id ? 1 : 0,
            matchWeight: match.matchWeight,
          },
        ],
      );

      await tx.player.update({
        where: { id: self.id },
        data: { internalRating: newRating, rd: newRD },
      });

      await tx.ratingChange.create({
        data: {
          playerId: self.id,
          tournamentId: null,
          ratingBefore: self.internalRating,
          ratingAfter: newRating,
          rdBefore: self.rd,
          rdAfter: newRD,
          changeType: 'casual',
          formulaVersion: FORMULA_VERSION,
          coefficientsSnapshot: FORMULA_COEFFICIENTS,
        },
      });
    }

    await tx.match.update({
      where: { id: matchId },
      data: { status: 'completed' },
    });
  });

  await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard`;

  console.log(`Casual-match rating job complete for ${matchId}`);
}

async function main() {
  const tournamentId = process.env.TOURNAMENT_ID;
  const matchId = process.env.MATCH_ID;
  if ((tournamentId == null) === (matchId == null)) {
    throw new Error(
      'Exactly one of TOURNAMENT_ID or MATCH_ID environment variables is required',
    );
  }

  // The CLI entry-point owns its own Prisma client; the worker functions
  // leave lifecycle to the caller so in-process triggers can share the
  // API's already-connected client without flipping it into disconnect.
  const prisma = new PrismaClient();
  try {
    if (tournamentId) {
      await processTournament(tournamentId, prisma);
    } else {
      await processCasualMatch(matchId!, prisma);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Only run the CLI when this file is the Node entry point. Other consumers
// (InProcessRatingJobTrigger in the API) import { processTournament } and
// must not trigger the TOURNAMENT_ID env check at module load.
if (require.main === module) {
  main().catch((e) => {
    console.error('Rating job failed:', e);
    process.exit(1);
  });
}
