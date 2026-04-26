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
    const r1 = sub.rounds[0];
    for (const p of r1.pairings) {
      const leftPlayer = resolveSlot(p.left, allParticipants);
      const rightPlayer = p.right ? resolveSlot(p.right, allParticipants) : null;
      // Bye: skip Match creation; the leftPlayer auto-advances.
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

function resolveSlot(slot: BracketSlotRef, participants: any[]): string {
  if (slot.kind === 'group') {
    const p = participants.find(p => p.groupLetter === slot.group && p.groupRank === slot.rank);
    if (!p) throw new Error(`could not resolve slot: group ${slot.group} rank ${slot.rank}`);
    return p.playerId;
  }
  throw new Error('cannot resolve winnerOf at R1 generation time');
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

    const winnersByPairingIdx = new Map<number, string>();
    const completedR1Pairings = await tx.match.findMany({
      where: { tournamentId, bracketLabel, round: completedRound },
    });
    let pairingIdx = 1;
    for (const shapePairing of sub.rounds[completedRound - 1].pairings) {
      if (shapePairing.right === null) {
        // Bye pairing — left auto-advanced.
        const leftSlot = shapePairing.left;
        const allParticipants = await tx.tournamentParticipant.findMany({
          where: { tournamentId, withdrawnAt: null },
        });
        winnersByPairingIdx.set(pairingIdx, resolveSlot(leftSlot, allParticipants));
      } else {
        const allParticipants = await tx.tournamentParticipant.findMany({
          where: { tournamentId, withdrawnAt: null },
        });
        const expectedLeft = shapePairing.left.kind === 'group'
          ? resolveSlot(shapePairing.left, allParticipants)
          : winnersByPairingIdx.get((shapePairing.left as any).pairingIndex)!;
        const expectedRight = shapePairing.right.kind === 'group'
          ? resolveSlot(shapePairing.right, allParticipants)
          : winnersByPairingIdx.get((shapePairing.right as any).pairingIndex)!;
        const m = completedR1Pairings.find((m: any) =>
          (m.player1Id === expectedLeft && m.player2Id === expectedRight) ||
          (m.player1Id === expectedRight && m.player2Id === expectedLeft));
        if (!m || !m.winnerId) {
          return;
        }
        winnersByPairingIdx.set(pairingIdx, m.winnerId);
      }
      pairingIdx++;
    }

    const newRows: any[] = [];
    for (const p of nextRoundShape.pairings) {
      const leftWinnerOf = (p.left as any).pairingIndex;
      const rightWinnerOf = p.right ? (p.right as any).pairingIndex : null;
      const leftPlayer = winnersByPairingIdx.get(leftWinnerOf)!;
      const rightPlayer = rightWinnerOf ? winnersByPairingIdx.get(rightWinnerOf)! : null;
      if (rightPlayer === null) continue;
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
