export type RrPairing = { round: number; player1Id: string; player2Id: string };

const BYE = '__bye__';

export function generateRoundRobinPairings(playerIds: string[]): RrPairing[] {
  if (playerIds.length < 2) throw new Error('at least 2 players required');
  const padded = playerIds.length % 2 === 0 ? [...playerIds] : [...playerIds, BYE];
  const N = padded.length;
  const rounds = N - 1;
  const half = N / 2;

  const positions = padded.slice();
  const out: RrPairing[] = [];

  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = positions[i];
      const b = positions[N - 1 - i];
      if (a !== BYE && b !== BYE) {
        out.push({ round: r, player1Id: a, player2Id: b });
      }
    }
    const moving = positions.slice(1);
    moving.push(moving.shift()!);
    for (let i = 1; i < N; i++) positions[i] = moving[i - 1];
  }
  return out;
}
