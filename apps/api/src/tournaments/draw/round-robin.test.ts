import { describe, it, expect } from 'vitest';
import { generateRoundRobinPairings } from './round-robin';

describe('generateRoundRobinPairings', () => {
  it('produces N*(N-1)/2 pairings for even N', () => {
    expect(generateRoundRobinPairings(['a','b','c','d']).length).toBe(6);
    expect(generateRoundRobinPairings(['a','b','c','d','e','f']).length).toBe(15);
    expect(generateRoundRobinPairings(['a','b','c','d','e','f','g','h']).length).toBe(28);
  });

  it('produces N*(N-1)/2 pairings for odd N (no bye matches in output)', () => {
    expect(generateRoundRobinPairings(['a','b','c']).length).toBe(3);
    expect(generateRoundRobinPairings(['a','b','c','d','e']).length).toBe(10);
    expect(generateRoundRobinPairings(['a','b','c','d','e','f','g']).length).toBe(21);
  });

  it('every pair appears exactly once', () => {
    const players = ['a','b','c','d','e','f'];
    const pairings = generateRoundRobinPairings(players);
    const seen = new Set<string>();
    for (const p of pairings) {
      const k = [p.player1Id, p.player2Id].sort().join('|');
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    expect(seen.size).toBe(15);
  });

  it('every player appears in exactly N-1 pairings', () => {
    const players = ['a','b','c','d','e'];
    const pairings = generateRoundRobinPairings(players);
    const counts = new Map<string, number>();
    for (const p of pairings) {
      counts.set(p.player1Id, (counts.get(p.player1Id) ?? 0) + 1);
      counts.set(p.player2Id, (counts.get(p.player2Id) ?? 0) + 1);
    }
    for (const player of players) {
      expect(counts.get(player)).toBe(4);
    }
  });

  it('round numbers are contiguous starting at 1', () => {
    const pairings = generateRoundRobinPairings(['a','b','c','d','e','f']);
    const rounds = new Set(pairings.map(p => p.round));
    expect(Math.min(...rounds)).toBe(1);
    expect(Math.max(...rounds)).toBe(5);
    expect(rounds.size).toBe(5);
  });

  it('throws for fewer than 2 players', () => {
    expect(() => generateRoundRobinPairings(['a'])).toThrow(/at least 2/);
  });
});
