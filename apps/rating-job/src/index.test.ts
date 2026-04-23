import { describe, it, expect } from 'vitest';
import { buildGlickoInputs } from './index';

type MinimalMatch = {
  player1Id: string;
  player2Id: string;
  winnerId: string | null;
  matchWeight: number;
};

describe('buildGlickoInputs', () => {
  const participantMap = new Map([
    ['player-b', { ratingBefore: 1600, rdBefore: 100 }],
    ['player-c', { ratingBefore: 1550, rdBefore: 120 }],
    ['player-d', { ratingBefore: 1400, rdBefore: 200 }],
  ]);

  it('returns empty array for player with no matches', () => {
    const inputs = buildGlickoInputs('player-a', [], participantMap);
    expect(inputs).toEqual([]);
  });

  it('maps a win correctly (score = 1)', () => {
    const matches: MinimalMatch[] = [
      { player1Id: 'player-a', player2Id: 'player-b', winnerId: 'player-a', matchWeight: 1.0 },
    ];
    const inputs = buildGlickoInputs('player-a', matches, participantMap);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual({
      opponentRating: 1600,
      opponentRD: 100,
      score: 1,
      matchWeight: 1.0,
    });
  });

  it('maps a loss correctly (score = 0)', () => {
    const matches: MinimalMatch[] = [
      { player1Id: 'player-c', player2Id: 'player-a', winnerId: 'player-c', matchWeight: 0.9 },
    ];
    const inputs = buildGlickoInputs('player-a', matches, participantMap);
    expect(inputs[0]).toEqual({
      opponentRating: 1550,
      opponentRD: 120,
      score: 0,
      matchWeight: 0.9,
    });
  });

  it('handles multiple matches for the same player', () => {
    const matches: MinimalMatch[] = [
      { player1Id: 'player-a', player2Id: 'player-b', winnerId: 'player-a', matchWeight: 1.0 },
      { player1Id: 'player-c', player2Id: 'player-a', winnerId: 'player-c', matchWeight: 0.85 },
      { player1Id: 'player-a', player2Id: 'player-d', winnerId: 'player-a', matchWeight: 0.8 },
    ];
    const inputs = buildGlickoInputs('player-a', matches, participantMap);
    expect(inputs).toHaveLength(3);
    expect(inputs[1].score).toBe(0); // loss
    expect(inputs[2].score).toBe(1); // win
  });

  it('preserves matchWeight from the match record', () => {
    const matches: MinimalMatch[] = [
      { player1Id: 'player-a', player2Id: 'player-b', winnerId: 'player-b', matchWeight: 0.8 },
    ];
    const inputs = buildGlickoInputs('player-a', matches, participantMap);
    expect(inputs[0].matchWeight).toBe(0.8);
  });

  it('filters out matches where the player is not involved', () => {
    const matches: MinimalMatch[] = [
      { player1Id: 'player-b', player2Id: 'player-c', winnerId: 'player-b', matchWeight: 1.0 },
    ];
    const inputs = buildGlickoInputs('player-a', matches, participantMap);
    expect(inputs).toHaveLength(0);
  });
});
