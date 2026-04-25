import { describe, it, expect } from 'vitest';
import { seedParticipants } from './seeding';

describe('seedParticipants', () => {
  it('seeds by internalRating descending', () => {
    const out = seedParticipants([
      { playerId: 'low',    internalRating: 1500 },
      { playerId: 'high',   internalRating: 1900 },
      { playerId: 'mid',    internalRating: 1700 },
    ]);
    expect(out.map(p => p.playerId)).toEqual(['high','mid','low']);
    expect(out.map(p => p.seed)).toEqual([1,2,3]);
  });

  it('breaks rating ties deterministically by playerId ascending', () => {
    const out = seedParticipants([
      { playerId: 'b', internalRating: 1700 },
      { playerId: 'a', internalRating: 1700 },
      { playerId: 'c', internalRating: 1700 },
    ]);
    expect(out.map(p => p.playerId)).toEqual(['a','b','c']);
  });

  it('applies manual overrides last (organizer wins)', () => {
    const out = seedParticipants(
      [
        { playerId: 'p1', internalRating: 1500 },
        { playerId: 'p2', internalRating: 1900 },
        { playerId: 'p3', internalRating: 1700 },
      ],
      { p1: 1 },
    );
    expect(out.find(p => p.playerId === 'p1')!.seed).toBe(1);
    expect(out.find(p => p.playerId === 'p2')!.seed).toBe(2);
    expect(out.find(p => p.playerId === 'p3')!.seed).toBe(3);
  });

  it('rejects override pointing to unknown playerId', () => {
    expect(() => seedParticipants(
      [{ playerId: 'p1', internalRating: 1500 }],
      { ghost: 1 },
    )).toThrow(/unknown playerId/);
  });

  it('rejects duplicate override seed numbers', () => {
    expect(() => seedParticipants(
      [
        { playerId: 'p1', internalRating: 1500 },
        { playerId: 'p2', internalRating: 1700 },
      ],
      { p1: 1, p2: 1 },
    )).toThrow(/duplicate seed/);
  });

  it('rejects override seed out of [1, N]', () => {
    expect(() => seedParticipants(
      [{ playerId: 'p1', internalRating: 1500 }],
      { p1: 5 },
    )).toThrow(/seed out of range/);
  });
});
