import { describe, it, expect } from 'vitest';
import { buildPlacementBrackets } from './bracket-shape';

describe('buildPlacementBrackets', () => {
  it('builds 4 sub-brackets for G=4 S=4 (places 1-4, 5-8, 9-12, 13-16)', () => {
    const shape = buildPlacementBrackets(4, 4);
    expect(shape.subBrackets.length).toBe(4);
    expect(shape.subBrackets.map(b => b.label)).toEqual([
      'places-1-to-4', 'places-5-to-8', 'places-9-to-12', 'places-13-to-16',
    ]);
    expect(shape.subBrackets[0].fromGroupRank).toBe(1);
    expect(shape.subBrackets[3].fromGroupRank).toBe(4);
  });

  it('every sub-bracket of G=4 has 2 rounds (R1: 2 pairings, F: 1 pairing)', () => {
    const shape = buildPlacementBrackets(4, 4);
    for (const b of shape.subBrackets) {
      expect(b.size).toBe(4);
      expect(b.rounds.length).toBe(2);
      expect(b.rounds[0].pairings.length).toBe(2);
      expect(b.rounds[1].pairings.length).toBe(1);
    }
  });

  it('R1 of rank-1 bracket pairs A-vs-D and B-vs-C (standard 1-vs-N seeded bracket)', () => {
    const shape = buildPlacementBrackets(4, 4);
    const r1 = shape.subBrackets[0].rounds[0];
    expect(r1.pairings[0].left).toEqual({ kind: 'group', group: 'A', rank: 1 });
    expect(r1.pairings[0].right).toEqual({ kind: 'group', group: 'D', rank: 1 });
    expect(r1.pairings[1].left).toEqual({ kind: 'group', group: 'B', rank: 1 });
    expect(r1.pairings[1].right).toEqual({ kind: 'group', group: 'C', rank: 1 });
  });

  it('final references winnerOf round 1 pairings', () => {
    const shape = buildPlacementBrackets(4, 4);
    const final = shape.subBrackets[0].rounds[1];
    expect(final.pairings[0].left).toEqual({ kind: 'winnerOf', round: 1, pairingIndex: 1 });
    expect(final.pairings[0].right).toEqual({ kind: 'winnerOf', round: 1, pairingIndex: 2 });
  });

  it('handles G=3 (next power-of-2 = 4) with one bye to seed 1', () => {
    const shape = buildPlacementBrackets(3, 4);
    const b = shape.subBrackets[0];
    expect(b.size).toBe(4);
    expect(b.rounds.length).toBe(2);
    expect(b.rounds[0].pairings.length).toBe(2);
    const bye = b.rounds[0].pairings.find(p => p.right === null);
    expect(bye).toBeDefined();
    expect(bye!.left).toEqual({ kind: 'group', group: 'A', rank: 1 });
  });

  it('handles G=8 (clean) with 3 rounds: QF→SF→F', () => {
    const shape = buildPlacementBrackets(8, 4);
    const b = shape.subBrackets[0];
    expect(b.size).toBe(8);
    expect(b.rounds.length).toBe(3);
    expect(b.rounds.map(r => r.pairings.length)).toEqual([4, 2, 1]);
    const qf = b.rounds[0].pairings;
    const groupOf = (slot: any) => slot.group;
    expect(qf.map(p => [groupOf(p.left), groupOf(p.right)])).toEqual([
      ['A','H'], ['D','E'], ['C','F'], ['B','G'],
    ]);
  });

  it('throws for G<2', () => {
    expect(() => buildPlacementBrackets(1, 4)).toThrow(/at least 2 groups/);
  });
});
