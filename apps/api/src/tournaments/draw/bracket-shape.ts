export type BracketSlotRef =
  | { kind: 'group'; group: string; rank: number }
  | { kind: 'winnerOf'; round: number; pairingIndex: number };

export type BracketPairing = { left: BracketSlotRef; right: BracketSlotRef | null };
export type BracketRound = { roundNumber: number; pairings: BracketPairing[] };
export type SubBracket = {
  label: string;
  fromGroupRank: number;
  size: number;
  rounds: BracketRound[];
};
export type BracketShape = { subBrackets: SubBracket[] };

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Standard tennis-seeded bracket pairing. For bracketSize slots, returns an
 * array of [topSeed, bottomSeed] pairs in pairing order. Seeds run 1..bracketSize;
 * if bracketSize > G, seeds beyond G are byes (bottomSeed > G).
 *
 * Recursive bracket build: for size 2n, take the seed-1 ordering for size n,
 * keep it as the top half (each seed s expanded to (s, 2n+1-s)), and for the
 * bottom half take the same ordering reversed so the seed-2 pairing lands at
 * the very bottom of the bracket. This matches the canonical "inner seeds in
 * the middle" tennis layout.
 */
function standardSeededPairs(bracketSize: number): Array<[number, number]> {
  // Build the canonical "inner seeds in the middle" layout. For each doubling
  // we expand each seed s → (s, n+1-s), then for sizes ≥ 8 we swap the two
  // quarters of the bottom half so seed 2's pairing lands at the very bottom.
  function seeds(n: number): number[] {
    if (n === 1) return [1];
    const half = seeds(n / 2);
    const expanded: number[] = [];
    for (const s of half) {
      expanded.push(s, n + 1 - s);
    }
    if (n < 8) return expanded;
    const halfLen = n / 2;
    const quarter = halfLen / 2;
    const result = expanded.slice(0, halfLen);
    // bottom half: swap its two quarters
    for (let i = 0; i < quarter; i++) result.push(expanded[halfLen + quarter + i]);
    for (let i = 0; i < quarter; i++) result.push(expanded[halfLen + i]);
    return result;
  }
  const positions = seeds(bracketSize);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < bracketSize; i += 2) {
    pairs.push([positions[i], positions[i + 1]]);
  }
  return pairs;
}

function buildSubBracket(label: string, fromGroupRank: number, G: number): SubBracket {
  const size = nextPow2(G);
  const seedPairs = standardSeededPairs(size);

  const r1Pairings: BracketPairing[] = seedPairs.map(([topSeed, botSeed]) => {
    const left: BracketSlotRef = { kind: 'group', group: LETTERS[topSeed - 1], rank: fromGroupRank };
    const right: BracketSlotRef | null = botSeed > G
      ? null
      : { kind: 'group', group: LETTERS[botSeed - 1], rank: fromGroupRank };
    return { left, right };
  });

  const rounds: BracketRound[] = [{ roundNumber: 1, pairings: r1Pairings }];

  let currentSize = size / 2;
  let prevRound = 1;
  while (currentSize > 1) {
    const pairings: BracketPairing[] = [];
    for (let i = 0; i < currentSize; i += 2) {
      pairings.push({
        left: { kind: 'winnerOf', round: prevRound, pairingIndex: i + 1 },
        right: { kind: 'winnerOf', round: prevRound, pairingIndex: i + 2 },
      });
    }
    prevRound++;
    rounds.push({ roundNumber: prevRound, pairings });
    currentSize = currentSize / 2;
  }
  return { label, fromGroupRank, size, rounds };
}

export function buildPlacementBrackets(groupCount: number, groupSize: number): BracketShape {
  if (groupCount < 2) throw new Error('at least 2 groups required for placement brackets');
  if (groupCount > LETTERS.length) {
    throw new Error(`too many groups: ${groupCount} (max ${LETTERS.length})`);
  }
  const subBrackets: SubBracket[] = [];
  for (let rank = 1; rank <= groupSize; rank++) {
    const lo = (rank - 1) * groupCount + 1;
    const hi = rank * groupCount;
    const label = `places-${lo}-to-${hi}`;
    subBrackets.push(buildSubBracket(label, rank, groupCount));
  }
  return { subBrackets };
}
