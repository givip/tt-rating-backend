import type { Prisma } from '@tt-rating/db/generated';
import { computeGroupStandings } from './tiebreakers';
import type { BracketShape, BracketSlotRef } from './bracket-shape';

export async function advanceBracket(
  tournamentId: string,
  completedMatchId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const tournament = await tx.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
  });
  const completedMatch = await tx.match.findUniqueOrThrow({
    where: { id: completedMatchId },
  });

  // Branch 1: round-robin tournament
  if (tournament.format === 'round_robin') {
    const allMatches = await tx.match.findMany({
      where: { tournamentId, status: 'completed' },
    });
    const scheduled = await tx.match.findMany({
      where: { tournamentId, status: 'scheduled' },
    });
    if (scheduled.length > 0) return;
    const participants = await tx.tournamentParticipant.findMany({
      where: { tournamentId, withdrawnAt: null },
    });
    const standings = computeGroupStandings(
      allMatches.map((m: any) => ({
        player1Id: m.player1Id, player2Id: m.player2Id,
        winnerId: m.winnerId!,
        setsPlayer1: m.setsPlayer1!, setsPlayer2: m.setsPlayer2!,
      })),
      participants.map((p: any) => ({ playerId: p.playerId })),
    );
    for (const row of standings) {
      await tx.tournamentParticipant.update({
        where: { tournamentId_playerId: { tournamentId, playerId: row.playerId } },
        data: { groupRank: row.groupRank, finalPosition: row.groupRank },
      });
    }
    return;
  }

  // Branch 2: groups_playoff
  if (tournament.format === 'groups_playoff') {
    if (completedMatch.groupLetter !== null) {
      await maybeCloseGroup(tournamentId, completedMatch.groupLetter, tx);
      await maybeGenerateBracketR1(tournamentId, tournament, tx);
    } else if (completedMatch.bracketLabel !== null) {
      await maybeAdvanceSubBracket(
        tournamentId,
        tournament,
        completedMatch.bracketLabel,
        completedMatch.round,
        tx,
      );
    }
    return;
  }
}

async function maybeCloseGroup(
  tournamentId: string,
  groupLetter: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const groupParticipants = await tx.tournamentParticipant.findMany({
    where: { tournamentId, groupLetter, withdrawnAt: null },
  });
  // Already closed?
  if (groupParticipants.every((p: any) => p.groupRank !== null)) return;

  const groupMatches = await tx.match.findMany({
    where: { tournamentId, groupLetter, status: 'completed' },
  });
  const N = groupParticipants.length;
  const expected = (N * (N - 1)) / 2;
  if (groupMatches.length < expected) return;

  const standings = computeGroupStandings(
    groupMatches.map((m: any) => ({
      player1Id: m.player1Id, player2Id: m.player2Id,
      winnerId: m.winnerId!,
      setsPlayer1: m.setsPlayer1!, setsPlayer2: m.setsPlayer2!,
    })),
    groupParticipants.map((p: any) => ({ playerId: p.playerId })),
  );
  for (const row of standings) {
    await tx.tournamentParticipant.update({
      where: { tournamentId_playerId: { tournamentId, playerId: row.playerId } },
      data: { groupRank: row.groupRank },
    });
  }
}

async function maybeGenerateBracketR1(
  tournamentId: string,
  tournament: { bracketShape: any },
  tx: Prisma.TransactionClient,
): Promise<void> {
  const allParticipants = await tx.tournamentParticipant.findMany({
    where: { tournamentId, withdrawnAt: null },
  });
  if (allParticipants.some((p: any) => p.groupRank === null)) return;

  // Idempotency: if any KO match exists, R1 was already generated.
  const existing = await tx.match.findMany({
    where: { tournamentId, bracketLabel: { not: null } },
  });
  if (existing.length > 0) return;

  const shape = tournament.bracketShape as BracketShape;
  const newRows: any[] = [];

  for (const sub of shape.subBrackets) {
    // Count actual entrants for this sub-bracket: how many active participants
    // would land in it given their groupRank? bracketShape was built at
    // prepare time assuming uniform groups; at advance time we may have
    // fewer entrants (drops in `prepared`, smaller groups, etc).
    const entrants = allParticipants.filter(
      (p: any) => p.groupRank === sub.fromGroupRank,
    );

    if (entrants.length === 0) {
      // No entrants — sub-bracket is empty. Skip entirely.
      continue;
    }
    if (entrants.length === 1) {
      // Lone entrant — no KO matches. Assign finalPosition directly from
      // the sub-bracket's `lo` value.
      const lo = parseLo(sub.label);
      if (lo !== null) {
        await tx.tournamentParticipant.update({
          where: {
            tournamentId_playerId: { tournamentId, playerId: entrants[0].playerId },
          },
          data: { finalPosition: lo },
        });
      }
      continue;
    }

    // Normal path: ≥2 entrants. Generate R1 Match rows from shape pairings,
    // skipping any pairing whose slot has no actual entrant (e.g., a group
    // ran short and its rank-K finisher doesn't exist).
    const r1 = sub.rounds[0];
    for (const p of r1.pairings) {
      const leftPlayer = resolveSlotIfPresent(p.left, allParticipants);
      const rightPlayer = p.right ? resolveSlotIfPresent(p.right, allParticipants) : null;
      // Skip if either slot can't be filled. A real bye (right === null in
      // shape) and a "missing entrant" both arrive here as `null`; both are
      // handled the same way — skip the pairing, the standing player (if
      // any) advances when the next round's opponent emerges.
      if (leftPlayer === null) continue;
      if (rightPlayer === null) continue;
      newRows.push({
        tournamentId,
        round: 1,
        player1Id: leftPlayer,
        player2Id: rightPlayer,
        bracketLabel: sub.label,
        status: 'scheduled',
        matchWeight: 1.0,
        matchType: 'tournament',
      });
    }
  }

  if (newRows.length > 0) {
    await tx.match.createMany({ data: newRows });
  }
}

/** Strict resolver — throws if the slot has no entrant. Used in the
 * post-R1 next-round generation path where slots SHOULD always resolve. */
function resolveSlot(slot: BracketSlotRef, participants: any[]): string {
  if (slot.kind === 'group') {
    const p = participants.find(p => p.groupLetter === slot.group && p.groupRank === slot.rank);
    if (!p) throw new Error(`could not resolve slot: group ${slot.group} rank ${slot.rank}`);
    return p.playerId;
  }
  throw new Error('cannot resolve winnerOf at R1 generation time');
}

/** Tolerant resolver — returns null if the slot has no actual entrant.
 * Used when generating R1 matches from a bracketShape that may have phantom
 * slots (drops in `prepared`, non-uniform groups). */
function resolveSlotIfPresent(slot: BracketSlotRef, participants: any[]): string | null {
  if (slot.kind === 'group') {
    const p = participants.find(p => p.groupLetter === slot.group && p.groupRank === slot.rank);
    return p ? p.playerId : null;
  }
  return null;
}

/** Parse 'places-7-to-9' → 7. Returns null on unrecognized labels. */
function parseLo(label: string): number | null {
  const m = label.match(/^places-(\d+)-to-\d+$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Resolve a slot reference using either participant data (for `group` slots)
 * or a previously-computed winners map (for `winnerOf` slots). Returns null
 * if the slot's group has no entrant at the requested rank, or if the prior
 * round's pairing produced no winner. */
function resolveSlotOrPriorWinner(
  slot: BracketSlotRef,
  participants: any[],
  winnersByRound: Map<number, Map<number, string>>,
): string | null {
  if (slot.kind === 'group') {
    return resolveSlotIfPresent(slot, participants);
  }
  const round = slot.round;
  const pairingIndex = slot.pairingIndex;
  return winnersByRound.get(round)?.get(pairingIndex) ?? null;
}

async function maybeAdvanceSubBracket(
  tournamentId: string,
  tournament: { bracketShape: any },
  bracketLabel: string,
  completedRound: number,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const roundMatches = await tx.match.findMany({
    where: { tournamentId, bracketLabel, round: completedRound, status: 'completed' },
  });
  const scheduledRoundMatches = await tx.match.findMany({
    where: { tournamentId, bracketLabel, round: completedRound, status: 'scheduled' },
  });
  if (scheduledRoundMatches.length > 0) return;

  const shape = tournament.bracketShape as BracketShape;
  const sub = shape.subBrackets.find(s => s.label === bracketLabel);
  if (!sub) throw new Error(`unknown bracket label: ${bracketLabel}`);

  const nextRoundShape = sub.rounds.find(r => r.roundNumber === completedRound + 1);
  if (nextRoundShape) {
    const existingNext = await tx.match.findMany({
      where: { tournamentId, bracketLabel, round: completedRound + 1 },
    });
    if (existingNext.length > 0) return; // idempotency

    // Build winners progressively from R1 through completedRound. For each
    // round R, we need to know the winner of every pairing — including byes
    // (whose "winner" is the auto-advancing left slot) — so the next round's
    // `winnerOf` references can be resolved.
    //
    // Walking only the just-completed round (the previous implementation)
    // worked when completedRound = 1 because R1 pairings reference groups
    // directly. For completedRound ≥ 2, R1's winners must already be in the
    // map before we can resolve R2's pairings.
    const allParticipants = await tx.tournamentParticipant.findMany({
      where: { tournamentId, withdrawnAt: null },
    });
    const winnersByRound = new Map<number, Map<number, string>>();
    for (let r = 1; r <= completedRound; r++) {
      const roundShape = sub.rounds[r - 1];
      const completedMatches = await tx.match.findMany({
        where: { tournamentId, bracketLabel, round: r },
      });
      const winnersThisRound = new Map<number, string>();
      let pIdx = 1;
      for (const shapePairing of roundShape.pairings) {
        if (shapePairing.right === null) {
          // Bye — left auto-advances IF the slot resolves.
          const leftPlayer = resolveSlotOrPriorWinner(shapePairing.left, allParticipants, winnersByRound);
          if (leftPlayer !== null) winnersThisRound.set(pIdx, leftPlayer);
        } else {
          const expectedLeft = resolveSlotOrPriorWinner(shapePairing.left, allParticipants, winnersByRound);
          const expectedRight = resolveSlotOrPriorWinner(shapePairing.right, allParticipants, winnersByRound);
          if (expectedLeft === null && expectedRight === null) {
            // Both slots phantom; pairing produces no winner. Skip.
          } else if (expectedLeft === null) {
            winnersThisRound.set(pIdx, expectedRight!);
          } else if (expectedRight === null) {
            winnersThisRound.set(pIdx, expectedLeft);
          } else {
            // Both slots resolved → look up the actual completed match row.
            const m = completedMatches.find((m: any) =>
              (m.player1Id === expectedLeft && m.player2Id === expectedRight) ||
              (m.player1Id === expectedRight && m.player2Id === expectedLeft));
            if (!m || !m.winnerId) return;  // round not fully completed yet
            winnersThisRound.set(pIdx, m.winnerId);
          }
        }
        pIdx++;
      }
      winnersByRound.set(r, winnersThisRound);
    }

    const completedRoundWinners = winnersByRound.get(completedRound)!;
    const newRows: any[] = [];
    for (const p of nextRoundShape.pairings) {
      const leftWinnerOf = (p.left as any).pairingIndex;
      const rightWinnerOf = p.right ? (p.right as any).pairingIndex : null;
      const leftPlayer = completedRoundWinners.get(leftWinnerOf) ?? null;
      const rightPlayer = rightWinnerOf ? (completedRoundWinners.get(rightWinnerOf) ?? null) : null;
      if (leftPlayer === null || rightPlayer === null) continue;
      newRows.push({
        tournamentId,
        round: completedRound + 1,
        player1Id: leftPlayer,
        player2Id: rightPlayer,
        bracketLabel,
        status: 'scheduled',
        matchWeight: 1.0,
        matchType: 'tournament',
      });
    }
    if (newRows.length > 0) {
      await tx.match.createMany({ data: newRows });
    }
  } else {
    // Final of this sub-bracket. Sweep all completed sub-bracket matches and
    // write finalPosition for every entrant in this sub-bracket:
    //   - Final winner gets `lo`.
    //   - Final loser gets `lo + 1`.
    //   - Earlier-round losers fill `lo + 2 ..` in (round-descending,
    //     seed-ascending) order — i.e., losers from later rounds get better
    //     final positions; ties within a round are broken by original
    //     tournament seed (lower seed = better placement).
    const finalMatch = roundMatches[0];
    if (!finalMatch || !finalMatch.winnerId) return;
    const labelMatch = sub.label.match(/^places-(\d+)-to-(\d+)$/);
    if (!labelMatch) return;
    const lo = parseInt(labelMatch[1], 10);

    // Collect all completed matches in this sub-bracket.
    const allSubBracketMatches = await tx.match.findMany({
      where: { tournamentId, bracketLabel, status: 'completed' },
      orderBy: { round: 'desc' },
    });

    const winnerId = finalMatch.winnerId;
    const loserId = winnerId === finalMatch.player1Id ? finalMatch.player2Id : finalMatch.player1Id;

    // Earlier-round losers, grouped by descending round.
    const earlierLosers: Array<{ playerId: string; round: number }> = [];
    for (const m of allSubBracketMatches) {
      if (m.id === finalMatch.id) continue;
      if (!m.winnerId) continue;
      const losingPlayer =
        m.winnerId === m.player1Id ? m.player2Id : m.player1Id;
      earlierLosers.push({ playerId: losingPlayer, round: m.round });
    }

    // Look up the seed for every earlier loser (and the final winner/loser too,
    // but those are placed first regardless).
    const allParticipants = await tx.tournamentParticipant.findMany({
      where: { tournamentId, withdrawnAt: null },
    });
    const seedById = new Map<string, number>();
    for (const p of allParticipants) {
      if (p.seed !== null) seedById.set(p.playerId, p.seed);
    }

    // Sort: round descending (later rounds = better placement), then seed
    // ascending within each round (lower seed = better placement).
    earlierLosers.sort((a, b) => {
      if (a.round !== b.round) return b.round - a.round;
      const sa = seedById.get(a.playerId) ?? Number.MAX_SAFE_INTEGER;
      const sb = seedById.get(b.playerId) ?? Number.MAX_SAFE_INTEGER;
      return sa - sb;
    });

    await tx.tournamentParticipant.update({
      where: { tournamentId_playerId: { tournamentId, playerId: winnerId } },
      data: { finalPosition: lo },
    });
    await tx.tournamentParticipant.update({
      where: { tournamentId_playerId: { tournamentId, playerId: loserId } },
      data: { finalPosition: lo + 1 },
    });
    for (let i = 0; i < earlierLosers.length; i++) {
      await tx.tournamentParticipant.update({
        where: {
          tournamentId_playerId: { tournamentId, playerId: earlierLosers[i].playerId },
        },
        data: { finalPosition: lo + 2 + i },
      });
    }
  }
}
