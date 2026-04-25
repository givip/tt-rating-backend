import type { Prisma } from '../../../../packages/db/generated';
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
    // Final of this sub-bracket. Write finalPosition for winner + runner-up only.
    const finalMatch = roundMatches[0];
    if (!finalMatch || !finalMatch.winnerId) return;
    const winnerId = finalMatch.winnerId;
    const loserId = finalMatch.winnerId === finalMatch.player1Id ? finalMatch.player2Id : finalMatch.player1Id;
    const labelMatch = sub.label.match(/^places-(\d+)-to-(\d+)$/);
    if (labelMatch) {
      const lo = parseInt(labelMatch[1], 10);
      await tx.tournamentParticipant.update({
        where: { tournamentId_playerId: { tournamentId, playerId: winnerId } },
        data: { finalPosition: lo },
      });
      await tx.tournamentParticipant.update({
        where: { tournamentId_playerId: { tournamentId, playerId: loserId } },
        data: { finalPosition: lo + 1 },
      });
    }
  }
}
