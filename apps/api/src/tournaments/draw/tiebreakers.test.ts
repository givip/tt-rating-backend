import { describe, it, expect } from 'vitest';
import { computeGroupStandings, TbMatch } from './tiebreakers';

const m = (
  p1: string, p2: string, winner: string, s1: number, s2: number,
  pp1?: number, pp2?: number,
): TbMatch => ({
  player1Id: p1, player2Id: p2, winnerId: winner,
  setsPlayer1: s1, setsPlayer2: s2,
  pointsPlayer1: pp1, pointsPlayer2: pp2,
});

describe('computeGroupStandings', () => {
  it('ranks by wins (points = 2 per win, 1 per loss)', () => {
    const matches = [
      m('A','B','A',3,1), m('A','C','A',3,0), m('A','D','A',3,2),
      m('B','C','B',3,1), m('B','D','B',3,0),
      m('C','D','C',3,2),
    ];
    const participants = [{playerId:'A'},{playerId:'B'},{playerId:'C'},{playerId:'D'}];
    const rows = computeGroupStandings(matches, participants);
    expect(rows.map(r => r.playerId)).toEqual(['A','B','C','D']);
    expect(rows.map(r => r.groupRank)).toEqual([1,2,3,4]);
  });

  it('breaks tie by head-to-head when two players tied on wins', () => {
    const matches = [
      m('A','B','A',3,1), m('A','C','C',1,3), m('A','D','A',3,0),
      m('B','C','B',3,2), m('B','D','B',3,1),
      m('C','D','D',2,3),
    ];
    const participants = [{playerId:'A'},{playerId:'B'},{playerId:'C'},{playerId:'D'}];
    const rows = computeGroupStandings(matches, participants);
    expect(rows[0].playerId).toBe('A');
    expect(rows[1].playerId).toBe('B');
  });

  it('breaks tie by sets ratio in tied subset only', () => {
    // 3-way tie at 1 win each among A, B, C.
    // A vs B (A 3:1) so A:3 B:1; B vs C (B 3:0) so B:3 C:0; C vs A (C 3:2) so C:3 A:2.
    // A in mini-table: sets W = 3+2 = 5, L = 1+3 = 4 → 5/4 = 1.25
    // B in mini-table: sets W = 1+3 = 4, L = 3+0 = 3 → 4/3 ≈ 1.333
    // C in mini-table: sets W = 0+3 = 3, L = 3+2 = 5 → 3/5 = 0.6
    const matches = [
      m('A','B','A',3,1), m('B','C','B',3,0), m('C','A','C',3,2),
      m('A','D','A',3,0), m('B','D','B',3,0), m('C','D','C',3,0),
    ];
    const participants = [{playerId:'A'},{playerId:'B'},{playerId:'C'},{playerId:'D'}];
    const rows = computeGroupStandings(matches, participants);
    expect(rows[3].playerId).toBe('D');
    expect(rows[0].playerId).toBe('B');
    expect(rows[1].playerId).toBe('A');
    expect(rows[2].playerId).toBe('C');
  });

  it('falls through to points ratio when sets ratio also ties', () => {
    // 3-way tie where each player wins 1 lost 1 in the cycle, sets 5W:5L each.
    // A 3:2 B (80:70); B 3:2 C (75:65); C 3:2 A (60:70).
    // Mini-table points:
    // A: 80 + 70 = 150 won, 70 + 60 = 130 lost  → ratio 150/130 ≈ 1.154
    // B: 70 + 75 = 145 won, 80 + 65 = 145 lost  → ratio 1.0
    // C: 65 + 60 = 125 won, 75 + 70 = 145 lost  → ratio ≈ 0.862
    const matches = [
      m('A','B','A',3,2, 80, 70),
      m('B','C','B',3,2, 75, 65),
      m('C','A','C',3,2, 60, 70),
      m('A','D','A',3,0), m('B','D','B',3,0), m('C','D','C',3,0),
    ];
    const participants = [{playerId:'A'},{playerId:'B'},{playerId:'C'},{playerId:'D'}];
    const rows = computeGroupStandings(matches, participants);
    expect(rows[3].playerId).toBe('D');
    expect(rows[0].playerId).toBe('A');
    expect(rows[1].playerId).toBe('B');
    expect(rows[2].playerId).toBe('C');
  });

  it('counts a player with no matches as 0 wins', () => {
    const matches = [ m('A','B','A',3,0), m('A','C','A',3,1), m('B','C','B',3,2) ];
    const participants = [{playerId:'A'},{playerId:'B'},{playerId:'C'},{playerId:'D'}];
    const rows = computeGroupStandings(matches, participants);
    expect(rows[3].playerId).toBe('D');
    expect(rows[3].wins).toBe(0);
  });
});
