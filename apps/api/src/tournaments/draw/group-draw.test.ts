import { describe, it, expect } from 'vitest';
import { distributeIntoGroups, SeededPlayer } from './group-draw';

const sp = (n: number): SeededPlayer => ({
  playerId: `p${n}`,
  seed: n,
  internalRating: 2000 - n,
});
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => sp(a + i));

describe('distributeIntoGroups', () => {
  it('snakes 16 players into 4 groups of 4', () => {
    const groups = distributeIntoGroups(range(1, 16), 4);
    expect(groups.length).toBe(4);
    expect(groups.map((g) => g.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(groups[0].players.map((p) => p.seed)).toEqual([1, 8, 9, 16]);
    expect(groups[1].players.map((p) => p.seed)).toEqual([2, 7, 10, 15]);
    expect(groups[2].players.map((p) => p.seed)).toEqual([3, 6, 11, 14]);
    expect(groups[3].players.map((p) => p.seed)).toEqual([4, 5, 12, 13]);
  });

  it('snakes 12 players into 3 groups of 4', () => {
    const groups = distributeIntoGroups(range(1, 12), 4);
    expect(groups.length).toBe(3);
    expect(groups[0].players.map((p) => p.seed)).toEqual([1, 6, 7, 12]);
    expect(groups[1].players.map((p) => p.seed)).toEqual([2, 5, 8, 11]);
    expect(groups[2].players.map((p) => p.seed)).toEqual([3, 4, 9, 10]);
  });

  it('snakes 20 players into 5 groups of 4', () => {
    const groups = distributeIntoGroups(range(1, 20), 4);
    expect(groups.length).toBe(5);
    expect(groups[0].players.map((p) => p.seed)).toEqual([1, 10, 11, 20]);
    expect(groups[4].players.map((p) => p.seed)).toEqual([5, 6, 15, 16]);
  });

  it('handles N=22, groupSize=4: 6 groups, sizes within [3,4]', () => {
    const groups = distributeIntoGroups(range(1, 22), 4);
    expect(groups.length).toBe(6);
    const sizes = groups.map((g) => g.players.length).sort();
    expect(sizes).toEqual([3, 3, 4, 4, 4, 4]);
  });

  it('rejects when balance constraint cannot be met', () => {
    // 5 players, groupSize=4: ceil(5/4)=2, slots=8, short=3 → sizes [3,2] or [4,1].
    // [3,2]: group 2 has size 2, NOT in [groupSize-1=3, groupSize+1=5] → reject.
    expect(() => distributeIntoGroups(range(1, 5), 4)).toThrow(/cannot balance/);
  });

  it('rejects groupSize < 3 or > 5', () => {
    expect(() => distributeIntoGroups(range(1, 8), 2)).toThrow(/groupSize/);
    expect(() => distributeIntoGroups(range(1, 12), 6)).toThrow(/groupSize/);
  });
});
