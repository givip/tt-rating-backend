export type TbMatch = {
  player1Id: string;
  player2Id: string;
  winnerId: string;
  setsPlayer1: number;
  setsPlayer2: number;
  pointsPlayer1?: number;
  pointsPlayer2?: number;
};

export type TbParticipant = { playerId: string };

export type RankedRow = {
  playerId: string;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  pointsWon: number;
  pointsLost: number;
  groupRank: number;
};

type Stats = {
  playerId: string;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  pointsWon: number;
  pointsLost: number;
};

function aggregateStats(matches: TbMatch[], playerIds: string[]): Map<string, Stats> {
  const idSet = new Set(playerIds);
  const stats = new Map<string, Stats>(
    playerIds.map(id => [id, {
      playerId: id, wins: 0, losses: 0,
      setsWon: 0, setsLost: 0, pointsWon: 0, pointsLost: 0,
    }]),
  );
  for (const m of matches) {
    if (!idSet.has(m.player1Id) || !idSet.has(m.player2Id)) continue;
    const s1 = stats.get(m.player1Id)!;
    const s2 = stats.get(m.player2Id)!;
    s1.setsWon  += m.setsPlayer1;  s1.setsLost  += m.setsPlayer2;
    s2.setsWon  += m.setsPlayer2;  s2.setsLost  += m.setsPlayer1;
    s1.pointsWon += m.pointsPlayer1 ?? 0;  s1.pointsLost += m.pointsPlayer2 ?? 0;
    s2.pointsWon += m.pointsPlayer2 ?? 0;  s2.pointsLost += m.pointsPlayer1 ?? 0;
    if (m.winnerId === m.player1Id) { s1.wins++; s2.losses++; }
    else                            { s2.wins++; s1.losses++; }
  }
  return stats;
}

/** Rank a tied subset using the RTTF cascade. Recurses on still-tied players. */
function rankTiedSubset(
  tiedIds: string[],
  allMatches: TbMatch[],
): string[] {
  if (tiedIds.length <= 1) return tiedIds;

  // Mini-table: only matches BETWEEN tied players count.
  const tiedSet = new Set(tiedIds);
  const miniMatches = allMatches.filter(m =>
    tiedSet.has(m.player1Id) && tiedSet.has(m.player2Id));
  const mini = aggregateStats(miniMatches, tiedIds);

  const cascades: Array<(s: Stats) => number> = [
    s => s.wins * 2 + s.losses,                                       // step 2: H2H points
    s => s.setsLost  === 0 ? Infinity : s.setsWon / s.setsLost,        // step 3: sets ratio
    s => s.pointsLost === 0 ? Infinity : s.pointsWon / s.pointsLost,    // step 4: points ratio
  ];

  let ordered = [...tiedIds];
  for (const score of cascades) {
    ordered.sort((a, b) => score(mini.get(b)!) - score(mini.get(a)!));
    const groups: string[][] = [];
    let runStart = 0;
    for (let i = 1; i <= ordered.length; i++) {
      if (i === ordered.length || score(mini.get(ordered[i])!) !== score(mini.get(ordered[runStart])!)) {
        groups.push(ordered.slice(runStart, i));
        runStart = i;
      }
    }
    if (groups.every(g => g.length === 1)) return ordered;
  }
  ordered.sort();
  return ordered;
}

export function computeGroupStandings(
  matches: TbMatch[],
  participants: TbParticipant[],
): RankedRow[] {
  const playerIds = participants.map(p => p.playerId);
  const totalStats = aggregateStats(matches, playerIds);

  const points = (id: string) => {
    const s = totalStats.get(id)!;
    return s.wins * 2 + s.losses;
  };
  const sortedByPoints = [...playerIds].sort((a, b) => points(b) - points(a));

  const ranked: string[] = [];
  let i = 0;
  while (i < sortedByPoints.length) {
    let j = i + 1;
    while (j < sortedByPoints.length && points(sortedByPoints[j]) === points(sortedByPoints[i])) {
      j++;
    }
    const tied = sortedByPoints.slice(i, j);
    ranked.push(...rankTiedSubset(tied, matches));
    i = j;
  }

  return ranked.map((playerId, idx) => {
    const s = totalStats.get(playerId)!;
    return {
      playerId,
      wins: s.wins, losses: s.losses,
      setsWon: s.setsWon, setsLost: s.setsLost,
      pointsWon: s.pointsWon, pointsLost: s.pointsLost,
      groupRank: idx + 1,
    };
  });
}
