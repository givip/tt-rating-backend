export type SeedInput = { playerId: string; internalRating: number };
export type SeededPlayer = SeedInput & { seed: number };

export function seedParticipants(
  participants: SeedInput[],
  overrides?: Record<string, number>,
): SeededPlayer[] {
  const N = participants.length;
  const ovr = overrides ?? {};

  const known = new Set(participants.map(p => p.playerId));
  const seenSeeds = new Set<number>();
  for (const [pid, seed] of Object.entries(ovr)) {
    if (!known.has(pid)) throw new Error(`unknown playerId in overrides: ${pid}`);
    if (seed < 1 || seed > N) throw new Error(`seed out of range: ${seed} (N=${N})`);
    if (seenSeeds.has(seed)) throw new Error(`duplicate seed in overrides: ${seed}`);
    seenSeeds.add(seed);
  }

  const sorted = [...participants].sort((a, b) => {
    if (b.internalRating !== a.internalRating) return b.internalRating - a.internalRating;
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  });

  const result: SeededPlayer[] = sorted.map((p, i) => ({ ...p, seed: i + 1 }));

  if (Object.keys(ovr).length > 0) {
    const pinned = new Map<string, number>(Object.entries(ovr));
    const free = result.filter(p => !pinned.has(p.playerId));
    const taken = new Set(pinned.values());
    let freeIdx = 0;
    const out: SeededPlayer[] = new Array(N);
    for (let seed = 1; seed <= N; seed++) {
      if (taken.has(seed)) {
        const pid = [...pinned.entries()].find(([_, s]) => s === seed)![0];
        const orig = result.find(p => p.playerId === pid)!;
        out[seed - 1] = { ...orig, seed };
      } else {
        const f = free[freeIdx++];
        out[seed - 1] = { ...f, seed };
      }
    }
    return out;
  }
  return result;
}
