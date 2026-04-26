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

/**
 * Build a sub-bracket for a specific rank, drawing from the given group
 * letters (in their natural order — snake-placement order is the caller's
 * responsibility). Bracket-seed 1 = first letter, 2 = second, etc.
 *
 * For non-power-of-2 entrant counts, top seeds get byes (right=null).
 *
 * @param label e.g. 'places-1-to-6'
 * @param fromGroupRank which group rank this sub-bracket draws from (1..S)
 * @param groups participating group letters; bracket-seeds are assigned in
 *               array order (1st = bracket-seed 1, etc.)
 */
function buildSubBracket(
  label: string,
  fromGroupRank: number,
  groups: string[],
): SubBracket {
  const G = groups.length;
  const size = nextPow2(G);
  const seedPairs = standardSeededPairs(size);

  const r1Pairings: BracketPairing[] = seedPairs.map(([topSeed, botSeed]) => {
    const left: BracketSlotRef = { kind: 'group', group: groups[topSeed - 1], rank: fromGroupRank };
    const right: BracketSlotRef | null = botSeed > G
      ? null
      : { kind: 'group', group: groups[botSeed - 1], rank: fromGroupRank };
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

/**
 * Build the parallel placement brackets for a groups+playoff tournament.
 *
 * Two call shapes:
 * 1. **Uniform groups** — `(groupCount, groupSize)`: all sub-brackets draw
 *    from groups A..groupCount. Backwards-compatible with Tier 1 callers.
 * 2. **Non-uniform groups** — `(groupsByRank)`: an array of length
 *    groupSize where `groupsByRank[k-1]` is the list of group letters that
 *    have a rank-k entrant. Sub-brackets where a rank has fewer than 2
 *    entrants are omitted (handled by the ≥2-entrants rule in advance.ts).
 */
export function buildPlacementBrackets(
  arg1: number | string[][],
  groupSize?: number,
): BracketShape {
  // Resolve into a uniform `groupsByRank: string[][]` representation.
  let groupsByRank: string[][];
  if (typeof arg1 === 'number') {
    if (groupSize === undefined) {
      throw new Error('groupSize required when first arg is a count');
    }
    if (arg1 < 2) throw new Error('at least 2 groups required for placement brackets');
    if (arg1 > LETTERS.length) {
      throw new Error(`too many groups: ${arg1} (max ${LETTERS.length})`);
    }
    const allLetters = LETTERS.slice(0, arg1).split('');
    groupsByRank = Array.from({ length: groupSize }, () => allLetters);
  } else {
    groupsByRank = arg1;
    if (groupsByRank.length === 0) {
      throw new Error('groupsByRank must have at least one rank');
    }
  }

  const subBrackets: SubBracket[] = [];
  let lo = 1;
  for (let rankIdx = 0; rankIdx < groupsByRank.length; rankIdx++) {
    const rank = rankIdx + 1;
    const groups = groupsByRank[rankIdx];
    if (groups.length === 0) {
      // No entrants at this rank — skip silently. (Shouldn't happen for v1
      // but documented for symmetry.)
      continue;
    }
    if (groups.length === 1) {
      // Lone entrant — handled by advance.ts at runtime via the ≥2-entrants
      // rule. Don't emit a sub-bracket here (advance assigns finalPosition
      // directly from the participant's rank).
      lo += 1;
      continue;
    }
    const hi = lo + groups.length - 1;
    const label = `places-${lo}-to-${hi}`;
    subBrackets.push(buildSubBracket(label, rank, groups));
    lo = hi + 1;
  }
  return { subBrackets };
}
