import { describe, it, expect, vi } from 'vitest';
import { advanceBracket } from './advance';

type Match = {
  id: string; tournamentId: string; status: string; round: number;
  player1Id: string; player2Id: string; winnerId: string | null;
  setsPlayer1: number | null; setsPlayer2: number | null;
  groupLetter: string | null; bracketLabel: string | null;
};
type Tournament = {
  id: string; format: string | null;
  groupSize: number | null; bracketShape: any | null;
};
type Participant = {
  tournamentId: string; playerId: string;
  groupLetter: string | null; groupRank: number | null;
  finalPosition: number | null; withdrawnAt: Date | null;
};

function buildTx(state: {
  tournament: Tournament;
  matches: Match[];
  participants: Participant[];
}) {
  const tx: any = {
    tournament: {
      findUniqueOrThrow: vi.fn(({ where: { id } }) => {
        if (id !== state.tournament.id) throw new Error('not found');
        return state.tournament;
      }),
    },
    match: {
      findUniqueOrThrow: vi.fn(({ where: { id } }) => {
        const m = state.matches.find(m => m.id === id);
        if (!m) throw new Error('match not found');
        return m;
      }),
      findMany: vi.fn(({ where }) => {
        return state.matches.filter(m => {
          if (where.tournamentId && m.tournamentId !== where.tournamentId) return false;
          if (where.groupLetter !== undefined && m.groupLetter !== where.groupLetter) return false;
          if (where.bracketLabel !== undefined) {
            if (where.bracketLabel === null && m.bracketLabel !== null) return false;
            if (where.bracketLabel !== null && typeof where.bracketLabel === 'object') {
              // { not: null } shape
              if (m.bracketLabel === null) return false;
            } else if (typeof where.bracketLabel === 'string' && m.bracketLabel !== where.bracketLabel) {
              return false;
            }
          }
          if (where.status && m.status !== where.status) return false;
          if (where.round !== undefined && m.round !== where.round) return false;
          return true;
        });
      }),
      createMany: vi.fn(({ data }) => {
        for (const row of data) state.matches.push({ ...row, id: `m-${state.matches.length + 1}` });
        return { count: data.length };
      }),
    },
    tournamentParticipant: {
      findMany: vi.fn(({ where }) => {
        return state.participants.filter(p => {
          if (where.tournamentId && p.tournamentId !== where.tournamentId) return false;
          if (where.groupLetter !== undefined && p.groupLetter !== where.groupLetter) return false;
          if (where.withdrawnAt !== undefined) {
            if (where.withdrawnAt === null && p.withdrawnAt !== null) return false;
            if (where.withdrawnAt !== null && p.withdrawnAt === null) return false;
          }
          return true;
        });
      }),
      update: vi.fn(({ where, data }) => {
        const p = state.participants.find(x =>
          x.tournamentId === where.tournamentId_playerId.tournamentId &&
          x.playerId === where.tournamentId_playerId.playerId,
        );
        if (!p) throw new Error('participant not found');
        Object.assign(p, data);
        return p;
      }),
    },
  };
  return tx;
}

describe('advanceBracket', () => {
  it('is a no-op when called for a non-group-completing match', async () => {
    const matches: Match[] = [
      { id: 'm1', tournamentId: 't1', status: 'completed', round: 1, player1Id:'p1', player2Id:'p2', winnerId:'p1', setsPlayer1:3, setsPlayer2:1, groupLetter:'A', bracketLabel:null },
      { id: 'm2', tournamentId: 't1', status: 'scheduled', round: 1, player1Id:'p1', player2Id:'p3', winnerId:null, setsPlayer1:null, setsPlayer2:null, groupLetter:'A', bracketLabel:null },
    ];
    const tx = buildTx({
      tournament: { id:'t1', format:'groups_playoff', groupSize:4, bracketShape:{subBrackets:[]} },
      matches,
      participants: [
        {tournamentId:'t1',playerId:'p1',groupLetter:'A',groupRank:null,finalPosition:null,withdrawnAt:null},
        {tournamentId:'t1',playerId:'p2',groupLetter:'A',groupRank:null,finalPosition:null,withdrawnAt:null},
        {tournamentId:'t1',playerId:'p3',groupLetter:'A',groupRank:null,finalPosition:null,withdrawnAt:null},
      ],
    });
    await advanceBracket('t1', 'm1', tx);
    expect(tx.tournamentParticipant.update).not.toHaveBeenCalled();
    expect(tx.match.createMany).not.toHaveBeenCalled();
  });

  it('writes groupRank when the last match in a round-robin tournament completes', async () => {
    const participants: Participant[] = [
      {tournamentId:'t1',playerId:'p1',groupLetter:null,groupRank:null,finalPosition:null,withdrawnAt:null},
      {tournamentId:'t1',playerId:'p2',groupLetter:null,groupRank:null,finalPosition:null,withdrawnAt:null},
    ];
    const matches: Match[] = [
      { id:'m1', tournamentId:'t1', status:'completed', round:1, player1Id:'p1', player2Id:'p2', winnerId:'p1', setsPlayer1:3, setsPlayer2:0, groupLetter:null, bracketLabel:null },
    ];
    const tx = buildTx({
      tournament: { id:'t1', format:'round_robin', groupSize:null, bracketShape:null },
      matches, participants,
    });
    await advanceBracket('t1', 'm1', tx);
    expect(participants.find(p=>p.playerId==='p1')!.groupRank).toBe(1);
    expect(participants.find(p=>p.playerId==='p2')!.groupRank).toBe(2);
  });
});
