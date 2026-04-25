export type SeededPlayer = { playerId: string; seed: number; internalRating: number };
export type GroupAssignment = { letter: string; players: SeededPlayer[] };

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function distributeIntoGroups(
  seededPlayers: SeededPlayer[],
  groupSize: number,
): GroupAssignment[] {
  if (groupSize < 3 || groupSize > 5) {
    throw new Error(`groupSize must be 3, 4, or 5; got ${groupSize}`);
  }
  const N = seededPlayers.length;
  const G = Math.ceil(N / groupSize);
  if (G > LETTERS.length) {
    throw new Error(`too many groups: ${G} (max ${LETTERS.length})`);
  }

  const ordered = [...seededPlayers].sort((a, b) => a.seed - b.seed);

  const groups: GroupAssignment[] = Array.from({ length: G }, (_, i) => ({
    letter: LETTERS[i],
    players: [],
  }));
  let pass = 0;
  let idx = 0;
  while (idx < N) {
    const reverse = pass % 2 === 1;
    const order = reverse ? [...groups].reverse() : groups;
    for (const g of order) {
      if (idx >= N) break;
      g.players.push(ordered[idx++]);
    }
    pass++;
  }

  const min = groupSize - 1;
  const max = groupSize + 1;
  for (const g of groups) {
    if (g.players.length < min || g.players.length > max) {
      throw new Error(
        `cannot balance groups for N=${N}, groupSize=${groupSize}: group ${g.letter} has ${g.players.length} players (allowed range [${min}, ${max}])`,
      );
    }
  }
  return groups;
}
