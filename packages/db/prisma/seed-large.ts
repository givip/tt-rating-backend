/**
 * Synthetic-data seeder for local development.
 *
 * Generates a richly populated dataset for browsing the UI with all Phase 1
 * features visible. Re-running is safe: every row uses a `synth-` prefixed ID
 * and is upserted. Set `SEED_RESET=true` to wipe prior synth-* rows first.
 *
 * Tunables (env vars, defaults shown):
 *   SEED_CLUBS=15
 *   SEED_PLAYERS=220
 *   SEED_TOURNAMENTS=45
 *   SEED_SNAPSHOT_MONTHS=12
 *   SEED_RESET=false
 *
 * Run with: pnpm -F @tt-rating/db exec ts-node -P tsconfig.seed.json prisma/seed-large.ts
 */

import {
  PrismaClient,
  Gender,
  RatingConfidence,
  UserRole,
  TournamentFormat,
  MatchFormat,
  TournamentCategory,
  TournamentStatus,
  MatchStatus,
  MatchType,
  RatingChangeType,
  PlayingHand,
} from '../generated';

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const CFG = {
  clubs: parseInt(process.env.SEED_CLUBS ?? '15', 10),
  players: parseInt(process.env.SEED_PLAYERS ?? '220', 10),
  tournaments: parseInt(process.env.SEED_TOURNAMENTS ?? '45', 10),
  snapshotMonths: parseInt(process.env.SEED_SNAPSHOT_MONTHS ?? '12', 10),
  reset: (process.env.SEED_RESET ?? 'false').toLowerCase() === 'true',
};

const SEED = 0xc0ffeeee;

// -----------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + helpers
// -----------------------------------------------------------------------------

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randNormal(mean: number, stddev: number): number {
  // Box–Muller
  const u1 = rng() || 1e-9;
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stddev;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

// -----------------------------------------------------------------------------
// Equipment pool
// -----------------------------------------------------------------------------

const RACKETS = [
  'Butterfly Viscaria',
  'Stiga Carbonado',
  'Donic Persson Powerplay',
  'Yasaka Sweden Extra',
  'Tibhar Stratus Power Wood',
] as const;

// -----------------------------------------------------------------------------
// Name pool (Georgian + ASCII transliteration)
// -----------------------------------------------------------------------------

const FIRST_NAMES_M: Array<{ ka: string; en: string }> = [
  { ka: 'ლაშა', en: 'Lasha' }, { ka: 'გიორგი', en: 'Giorgi' }, { ka: 'დავით', en: 'Davit' },
  { ka: 'ნიკა', en: 'Nika' }, { ka: 'სანდრო', en: 'Sandro' }, { ka: 'ლევან', en: 'Levan' },
  { ka: 'ზურაბ', en: 'Zurab' }, { ka: 'ვახტანგ', en: 'Vakhtang' }, { ka: 'ბექა', en: 'Beka' },
  { ka: 'ირაკლი', en: 'Irakli' }, { ka: 'მერაბ', en: 'Merab' }, { ka: 'ოთარ', en: 'Otar' },
  { ka: 'შოთა', en: 'Shota' }, { ka: 'თორნიკე', en: 'Tornike' }, { ka: 'გელა', en: 'Gela' },
  { ka: 'რევაზ', en: 'Revaz' }, { ka: 'კახა', en: 'Kakha' }, { ka: 'ნოდარ', en: 'Nodar' },
  { ka: 'მიხეილ', en: 'Mikheil' }, { ka: 'ალექსანდრე', en: 'Aleksandre' },
  { ka: 'ბაჩანა', en: 'Bachana' }, { ka: 'გივი', en: 'Givi' }, { ka: 'ბადრი', en: 'Badri' },
  { ka: 'ვალერი', en: 'Valeri' }, { ka: 'რომან', en: 'Roman' }, { ka: 'არჩილ', en: 'Archil' },
  { ka: 'ვასილ', en: 'Vasil' }, { ka: 'ანზორ', en: 'Anzor' }, { ka: 'სოსო', en: 'Soso' },
  { ka: 'ტარიელ', en: 'Tariel' },
];

const FIRST_NAMES_F: Array<{ ka: string; en: string }> = [
  { ka: 'ნინო', en: 'Nino' }, { ka: 'მარი', en: 'Mari' }, { ka: 'ანა', en: 'Ana' },
  { ka: 'თამთა', en: 'Tamta' }, { ka: 'სალომე', en: 'Salome' }, { ka: 'ქეთი', en: 'Keti' },
  { ka: 'ნათია', en: 'Natia' }, { ka: 'ლანა', en: 'Lana' }, { ka: 'ეკა', en: 'Eka' },
  { ka: 'თეა', en: 'Tea' }, { ka: 'მარიამ', en: 'Mariam' }, { ka: 'ლიკა', en: 'Lika' },
  { ka: 'ელენე', en: 'Elene' }, { ka: 'ნანა', en: 'Nana' }, { ka: 'ხათუნა', en: 'Khatuna' },
  { ka: 'ლელა', en: 'Lela' }, { ka: 'მაგდა', en: 'Magda' }, { ka: 'სოფიო', en: 'Sopio' },
  { ka: 'ციცინო', en: 'Tsitsino' }, { ka: 'ლიანა', en: 'Liana' }, { ka: 'მზია', en: 'Mzia' },
  { ka: 'ნანული', en: 'Nanuli' }, { ka: 'რუსუდან', en: 'Rusudan' }, { ka: 'თინათინ', en: 'Tinatin' },
  { ka: 'მანანა', en: 'Manana' }, { ka: 'ლეილა', en: 'Leila' }, { ka: 'ნუცა', en: 'Nutsa' },
  { ka: 'ცირა', en: 'Tsira' }, { ka: 'მარინე', en: 'Marine' }, { ka: 'დარეჯან', en: 'Darejan' },
];

const LAST_NAMES: Array<{ ka: string; en: string }> = [
  { ka: 'ბერიძე', en: 'Beridze' }, { ka: 'კვარაცხელია', en: 'Kvaratskhelia' },
  { ka: 'ჩიქოვანი', en: 'Chikovani' }, { ka: 'ჟღენტი', en: 'Zhghenti' },
  { ka: 'გამყრელიძე', en: 'Gamkrelidze' }, { ka: 'ნიჟარაძე', en: 'Nizharadze' },
  { ka: 'ხვედელიძე', en: 'Khvedelidze' }, { ka: 'ფხაკაძე', en: 'Pkhakadze' },
  { ka: 'ასათიანი', en: 'Asatiani' }, { ka: 'სამადაშვილი', en: 'Samadashvili' },
  { ka: 'ლომიძე', en: 'Lomidze' }, { ka: 'მაისურაძე', en: 'Maisuradze' },
  { ka: 'ჯავახიშვილი', en: 'Javakhishvili' }, { ka: 'ცერცვაძე', en: 'Tsertsvadze' },
  { ka: 'ჭანტურია', en: 'Chanturia' }, { ka: 'გელაშვილი', en: 'Gelashvili' },
  { ka: 'კობახიძე', en: 'Kobakhidze' }, { ka: 'წერეთელი', en: 'Tsereteli' },
  { ka: 'ქართველიშვილი', en: 'Kartvelishvili' }, { ka: 'სვანიძე', en: 'Svanidze' },
  { ka: 'ციმაკურიძე', en: 'Tsimakuridze' }, { ka: 'მაჭავარიანი', en: 'Machavariani' },
  { ka: 'ბურჯანაძე', en: 'Burjanadze' }, { ka: 'შენგელია', en: 'Shengelia' },
  { ka: 'ცხადაძე', en: 'Tskhadadze' }, { ka: 'გუგუშვილი', en: 'Gugushvili' },
  { ka: 'ხუციშვილი', en: 'Khutsishvili' }, { ka: 'ფირცხალავა', en: 'Pirtskhalava' },
  { ka: 'მგელაძე', en: 'Mgeladze' }, { ka: 'დოლიძე', en: 'Dolidze' },
];

const CITIES = ['Tbilisi', 'Kutaisi', 'Batumi', 'Rustavi', 'Zugdidi', 'Telavi', 'Gori', 'Poti'];

const CLUB_NAMES: Array<{ ka: string; en: string }> = [
  { ka: 'პროსპინი', en: 'ProSpin' }, { ka: 'თბილისი TT', en: 'Tbilisi TT' },
  { ka: 'დინამო', en: 'Dynamo' }, { ka: 'ლოკომოტივი', en: 'Lokomotiv' },
  { ka: 'ენერგია', en: 'Energia' }, { ka: 'ტორპედო', en: 'Torpedo' },
  { ka: 'სპარტაკი', en: 'Spartak' }, { ka: 'მერანი', en: 'Merani' },
  { ka: 'არსენალი', en: 'Arsenal' }, { ka: 'საბურთალო', en: 'Saburtalo' },
  { ka: 'ფოთი TT', en: 'Poti TT' }, { ka: 'კოლხეთი', en: 'Kolkheti' },
  { ka: 'მაგნუმი', en: 'Magnum' }, { ka: 'ვერა სპორტი', en: 'Vera Sport' },
  { ka: 'რუსთავი ცენტრალი', en: 'Rustavi Central' }, { ka: 'გორის TT', en: 'Gori TT' },
  { ka: 'თელავი არენა', en: 'Telavi Arena' }, { ka: 'ბათუმი TT', en: 'Batumi TT' },
  { ka: 'ზუგდიდი TT', en: 'Zugdidi TT' }, { ka: 'ქუთაისი TT', en: 'Kutaisi TT' },
];

const TOURNAMENT_TITLES = [
  'Open', 'Cup', 'Championship', 'Masters', 'Classic', 'Invitational',
  'Memorial', 'Grand Prix', 'Trophy', 'Challenge', 'Series', 'Festival',
];

const VENUES_SUFFIX = ['Sports Hall', 'Arena', 'Sports Complex', 'TT Center', 'Athletics Hall'];

// -----------------------------------------------------------------------------
// Helpers for dates
// -----------------------------------------------------------------------------

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

function startOfDayUTC(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

// -----------------------------------------------------------------------------
// Reset (only synth-* rows)
// -----------------------------------------------------------------------------

async function resetSynth(): Promise<void> {
  console.log('[seed-large] SEED_RESET=true — clearing prior synth-* rows...');
  // Order: leaf -> root. RatingSnapshot has no `id` so use playerId LIKE.
  await prisma.$executeRaw`DELETE FROM rating_changes WHERE player_id LIKE 'synth-%' OR tournament_id LIKE 'synth-%'`;
  await prisma.$executeRaw`DELETE FROM rating_snapshots WHERE player_id LIKE 'synth-%'`;
  await prisma.$executeRaw`DELETE FROM matches WHERE id LIKE 'synth-%'`;
  await prisma.$executeRaw`DELETE FROM tournament_participants WHERE tournament_id LIKE 'synth-%' OR player_id LIKE 'synth-%'`;
  await prisma.$executeRaw`DELETE FROM tournaments WHERE id LIKE 'synth-%'`;
  await prisma.$executeRaw`DELETE FROM players WHERE id LIKE 'synth-%'`;
  await prisma.$executeRaw`DELETE FROM users WHERE id LIKE 'synth-%'`;
  await prisma.$executeRaw`DELETE FROM clubs WHERE id LIKE 'synth-%'`;
}

// -----------------------------------------------------------------------------
// In-memory player state (so we can roll rating + RD across tournaments)
// -----------------------------------------------------------------------------

interface PlayerState {
  id: string;
  userId: string;
  firstNameKa: string;
  lastNameKa: string;
  firstNameEn: string;
  lastNameEn: string;
  gender: Gender;
  city: string;
  clubId: string | null;
  rating: number;
  rd: number;
  provisional: boolean;
  tournamentsPlayed: number;
  /** Rating at end of seeding (post all completed tournaments). */
  finalRating: number;
  /** Snapshots produced for this player (oldest -> newest). */
  monthlyRatings?: Array<{ date: Date; rating: number; rd: number }>;
}

interface ClubState {
  id: string;
  city: string;
  nameEn: string;
}

// -----------------------------------------------------------------------------
// Set-score generation
// -----------------------------------------------------------------------------

function pickSetScore(format: MatchFormat, upset: boolean): { winner: number; loser: number } {
  // first to 3 (bo5) or first to 4 (bo7)
  const winNeeded = format === MatchFormat.bo7 ? 4 : 3;
  // distribution: 3-0 ~30%, 3-1 ~40%, 3-2 ~30% (closer when upset)
  const r = rng();
  let loserSets: number;
  if (upset) {
    // upsets tend to be tighter
    loserSets = r < 0.15 ? winNeeded - 3 : r < 0.5 ? winNeeded - 2 : winNeeded - 1;
  } else {
    loserSets = r < 0.3 ? 0 : r < 0.7 ? winNeeded - 2 : winNeeded - 1;
  }
  loserSets = Math.max(0, Math.min(winNeeded - 1, loserSets));
  return { winner: winNeeded, loser: loserSets };
}

// -----------------------------------------------------------------------------
// Glicko-ish rating update (simplified for synthetic data)
// -----------------------------------------------------------------------------

function applyRatingUpdate(
  winner: PlayerState,
  loser: PlayerState,
  weight = 1.0,
): { winnerDelta: number; loserDelta: number; wBefore: number; wAfter: number; rdwBefore: number; rdwAfter: number; lBefore: number; lAfter: number; rdlBefore: number; rdlAfter: number } {
  const wBefore = winner.rating;
  const lBefore = loser.rating;
  const rdwBefore = winner.rd;
  const rdlBefore = loser.rd;

  // expected outcome based on rating gap
  const exp = 1 / (1 + Math.pow(10, (loser.rating - winner.rating) / 400));
  const k = 32 * weight;
  const winnerDelta = Math.round(k * (1 - exp));
  const loserDelta = -Math.round(k * exp);

  winner.rating = clamp(winner.rating + winnerDelta, 1200, 2600);
  loser.rating = clamp(loser.rating + loserDelta, 1200, 2600);

  // Shrink RD gradually
  winner.rd = Math.max(40, winner.rd - 3);
  loser.rd = Math.max(40, loser.rd - 3);

  return {
    winnerDelta,
    loserDelta,
    wBefore,
    wAfter: winner.rating,
    rdwBefore,
    rdwAfter: winner.rd,
    lBefore,
    lAfter: loser.rating,
    rdlBefore,
    rdlAfter: loser.rd,
  };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const startMs = Date.now();
  console.log(
    `[seed-large] Config: clubs=${CFG.clubs} players=${CFG.players} tournaments=${CFG.tournaments} ` +
      `snapshotMonths=${CFG.snapshotMonths} reset=${CFG.reset}`,
  );

  if (CFG.reset) {
    await resetSynth();
  }

  // -----------------------------------------------------------------------
  // Organizer user
  // -----------------------------------------------------------------------
  const organizerId = 'synth-organizer-001';
  await prisma.user.upsert({
    where: { id: organizerId },
    update: {},
    create: {
      id: organizerId,
      phone: '+995551900001',
      email: 'synth-organizer@ttr.local',
      role: UserRole.organizer,
    },
  });

  // -----------------------------------------------------------------------
  // Clubs
  // -----------------------------------------------------------------------
  const clubs: ClubState[] = [];
  const clubCount = Math.min(CFG.clubs, CLUB_NAMES.length);
  for (let i = 0; i < clubCount; i++) {
    const id = `synth-club-${pad(i + 1, 3)}`;
    const name = CLUB_NAMES[i];
    const city = CITIES[i % CITIES.length];
    await prisma.club.upsert({
      where: { id },
      update: {},
      create: {
        id,
        nameKa: name.ka,
        nameEn: name.en,
        city,
        address: `${randInt(1, 200)} ${randChoice(['Rustaveli', 'Vazha-Pshavela', 'Aghmashenebeli', 'Chavchavadze'])} Ave`,
        phone: `+9953222${pad(randInt(10000, 99999), 5)}`,
      },
    });
    clubs.push({ id, city, nameEn: name.en });
  }
  console.log(`[seed-large] Clubs: ${clubs.length}`);

  // -----------------------------------------------------------------------
  // Players (+ Users)
  // -----------------------------------------------------------------------
  const players: PlayerState[] = [];
  for (let i = 0; i < CFG.players; i++) {
    const idx = i + 1;
    const userId = `synth-user-${pad(idx, 4)}`;
    const playerId = `synth-player-${pad(idx, 4)}`;

    const isFemale = rng() < 0.4;
    const gender: Gender = isFemale ? Gender.F : Gender.M;
    const first = isFemale ? randChoice(FIRST_NAMES_F) : randChoice(FIRST_NAMES_M);
    const last = randChoice(LAST_NAMES);

    // ~12% unaffiliated
    const clubId = rng() < 0.88 ? randChoice(clubs).id : null;
    const city = clubId ? clubs.find((c) => c.id === clubId)!.city : randChoice(CITIES);

    let rating = clamp(randNormal(1700, 250), 1300, 2400);
    rating = Math.round(rating);
    const provisional = rng() < 0.15;
    const rd = provisional ? randInt(150, 220) : randInt(55, 130);
    const tournamentsPlayed = provisional ? randInt(0, 4) : randInt(5, 30);
    const ratingConfidence: RatingConfidence = provisional
      ? RatingConfidence.low
      : rd < 80
        ? RatingConfidence.high
        : RatingConfidence.medium;

    // ~70% have a known racket; the rest null.
    const racket = rng() < 0.7 ? randChoice(RACKETS) : null;
    // 85% right-handed, 15% left-handed.
    const playingHand: PlayingHand = rng() < 0.85 ? PlayingHand.right : PlayingHand.left;
    // Birth date between 1965-01-01 and 2010-01-01 (inclusive ish).
    const birthYear = randInt(1965, 2009);
    const birthDate = new Date(Date.UTC(birthYear, randInt(0, 11), randInt(1, 28)));

    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        phone: `+9955551${pad(idx, 6)}`,
        role: UserRole.player,
      },
    });

    await prisma.player.upsert({
      where: { id: playerId },
      update: {},
      create: {
        id: playerId,
        userId,
        firstNameKa: first.ka,
        lastNameKa: last.ka,
        firstNameEn: first.en,
        lastNameEn: last.en,
        gender,
        city,
        clubId,
        internalRating: rating,
        rd,
        provisional,
        tournamentsPlayed,
        ratingConfidence,
        isActive: true,
        birthDate,
        racket,
        playingHand,
      },
    });

    players.push({
      id: playerId,
      userId,
      firstNameKa: first.ka,
      lastNameKa: last.ka,
      firstNameEn: first.en,
      lastNameEn: last.en,
      gender,
      city,
      clubId,
      rating,
      rd,
      provisional,
      tournamentsPlayed,
      finalRating: rating,
    });
  }
  console.log(`[seed-large] Players: ${players.length}`);

  // -----------------------------------------------------------------------
  // Tournaments
  // -----------------------------------------------------------------------
  const today = new Date();
  const earliest = addMonths(today, -14);
  const totalSpanMs = today.getTime() - earliest.getTime();

  // Build status distribution
  const tournamentBlueprint: Array<{
    id: string;
    title: string;
    status: TournamentStatus;
    format: TournamentFormat;
    matchFormat: MatchFormat;
    category: TournamentCategory;
    club: ClubState;
    startsAt: Date;
    endsAt: Date;
    size: number;
    groupCount?: number;
  }> = [];

  function categoryPick(): TournamentCategory {
    const r = rng();
    if (r < 0.65) return TournamentCategory.open;
    if (r < 0.80) return TournamentCategory.women;
    if (r < 0.92) return TournamentCategory.under18;
    return TournamentCategory.veterans40;
  }

  function statusForIndex(i: number, total: number): TournamentStatus {
    const ratio = i / total;
    // First ~80% completed (in past), then in_progress, then open/prepared, then draft, then cancelled
    if (ratio < 0.80) return TournamentStatus.completed;
    if (ratio < 0.85) return TournamentStatus.in_progress;
    if (ratio < 0.93) return rng() < 0.5 ? TournamentStatus.open : TournamentStatus.prepared;
    if (ratio < 0.96) return TournamentStatus.draft;
    if (ratio < 0.98) return TournamentStatus.cancelled;
    return TournamentStatus.completed;
  }

  for (let i = 0; i < CFG.tournaments; i++) {
    const idx = i + 1;
    const id = `synth-tournament-${pad(idx, 3)}`;
    const status = statusForIndex(i, CFG.tournaments);

    let startsAt: Date;
    if (status === TournamentStatus.completed || status === TournamentStatus.cancelled) {
      // past
      const offset = (i / CFG.tournaments) * totalSpanMs * 0.95;
      startsAt = new Date(earliest.getTime() + offset + randInt(0, 6) * 24 * 3600 * 1000);
      // Ensure clearly in the past
      if (startsAt.getTime() > today.getTime() - 24 * 3600 * 1000) {
        startsAt = addDays(today, -randInt(2, 60));
      }
    } else if (status === TournamentStatus.in_progress) {
      startsAt = addDays(today, -randInt(0, 1));
    } else {
      // future
      startsAt = addDays(today, randInt(7, 90));
    }
    startsAt.setUTCHours(10, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 10 * 3600 * 1000);

    // Format mix
    const fr = rng();
    let format: TournamentFormat;
    let size: number;
    let groupCount: number | undefined;
    if (fr < 0.5) {
      format = TournamentFormat.single_elim;
      size = randChoice([8, 16, 32]);
    } else if (fr < 0.8) {
      format = TournamentFormat.round_robin;
      size = randInt(6, 12);
    } else {
      format = TournamentFormat.groups_playoff;
      size = randChoice([16, 24]);
      groupCount = size === 16 ? 4 : 6;
    }

    const matchFormat = rng() < 0.7 ? MatchFormat.bo5 : MatchFormat.bo7;
    const club = randChoice(clubs);
    const category = categoryPick();

    const titleSuffix = randChoice(TOURNAMENT_TITLES);
    const monthName = startsAt.toLocaleString('en-US', { month: 'long' });
    const year = startsAt.getUTCFullYear();
    const title = `${club.nameEn} ${titleSuffix} ${monthName} ${year}`;

    tournamentBlueprint.push({
      id,
      title,
      status,
      format,
      matchFormat,
      category,
      club,
      startsAt,
      endsAt,
      size,
      groupCount,
    });
  }

  // -----------------------------------------------------------------------
  // Process tournaments in chronological order so player ratings evolve
  // -----------------------------------------------------------------------
  tournamentBlueprint.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  let matchesCreated = 0;
  let participantsCreated = 0;
  let ratingChangesCreated = 0;
  const tournamentStatusCounts: Record<string, number> = {
    completed: 0,
    in_progress: 0,
    open: 0,
    prepared: 0,
    draft: 0,
    cancelled: 0,
  };

  function pickParticipants(category: TournamentCategory, n: number): PlayerState[] {
    let pool = players;
    if (category === TournamentCategory.women) {
      pool = players.filter((p) => p.gender === Gender.F);
    } else if (category === TournamentCategory.under18) {
      pool = players; // any (we don't strictly enforce age in synth)
    } else if (category === TournamentCategory.veterans40) {
      pool = players;
    }
    if (pool.length < n) pool = players;
    // Shuffle (Fisher-Yates with seeded RNG) and take n
    const arr = pool.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, n);
  }

  for (const tb of tournamentBlueprint) {
    tournamentStatusCounts[tb.status] = (tournamentStatusCounts[tb.status] ?? 0) + 1;

    const participants =
      tb.status === TournamentStatus.draft ? [] : pickParticipants(tb.category, tb.size);

    await prisma.tournament.upsert({
      where: { id: tb.id },
      update: {},
      create: {
        id: tb.id,
        title: tb.title,
        organizerId,
        clubId: tb.club.id,
        venueName: `${tb.club.nameEn} ${randChoice(VENUES_SUFFIX)}`,
        address: `${randInt(1, 100)} ${randChoice(['Main', 'Central', 'Sport'])} St`,
        city: tb.club.city,
        startsAt: tb.startsAt,
        endsAt: tb.endsAt,
        format: tb.format,
        matchFormat: tb.matchFormat,
        category: tb.category,
        maxParticipants: tb.size,
        onlineRegistration: true,
        registrationDeadline: addDays(tb.startsAt, -3),
        status: tb.status,
        participantsCount: participants.length,
        processed: tb.status === TournamentStatus.completed,
      },
    });

    if (participants.length === 0) continue;

    // Sort by rating descending => seed 1 is highest-rated
    const sortedParticipants = participants
      .slice()
      .sort((a, b) => b.rating - a.rating);

    // Capture pre-tournament ratings
    const preRatings = new Map<string, { rating: number; rd: number }>();
    for (const p of sortedParticipants) {
      preRatings.set(p.id, { rating: p.rating, rd: p.rd });
    }

    // Determine final positions for completed tournaments
    const finalPositions = new Map<string, number>();

    if (tb.status === TournamentStatus.completed) {
      // Generate matches per format
      if (tb.format === TournamentFormat.single_elim) {
        await runSingleElim(tb, sortedParticipants, finalPositions, () => matchesCreated++);
      } else if (tb.format === TournamentFormat.round_robin) {
        await runRoundRobin(tb, sortedParticipants, finalPositions, () => matchesCreated++);
      } else {
        await runGroupsPlayoff(tb, sortedParticipants, finalPositions, () => matchesCreated++);
      }
    } else if (tb.status === TournamentStatus.in_progress) {
      // Some matches completed, one in_progress, rest scheduled
      // Use a small single-elim subset regardless of format (synthetic; visual only)
      const ipPlayers = sortedParticipants.slice(0, Math.min(8, sortedParticipants.length));
      let mIdx = 1;
      for (let i = 0; i < ipPlayers.length / 2; i++) {
        const p1 = ipPlayers[i * 2];
        const p2 = ipPlayers[i * 2 + 1];
        if (!p2) continue;
        const isLast = i === Math.floor(ipPlayers.length / 2) - 1;
        const status = isLast ? MatchStatus.in_progress : i < 1 ? MatchStatus.completed : MatchStatus.scheduled;
        const matchId = `synth-match-${tb.id.replace('synth-tournament-', 't')}-r01-m${pad(mIdx, 2)}`;
        const winnerSets = pickSetScore(tb.matchFormat, false);
        await prisma.match.upsert({
          where: { id: matchId },
          update: {},
          create: {
            id: matchId,
            tournamentId: tb.id,
            matchType: MatchType.tournament,
            round: 1,
            player1Id: p1.id,
            player2Id: p2.id,
            winnerId: status === MatchStatus.completed ? p1.id : null,
            setsPlayer1: status === MatchStatus.completed ? winnerSets.winner : null,
            setsPlayer2: status === MatchStatus.completed ? winnerSets.loser : null,
            status,
            playedAt: status === MatchStatus.scheduled ? null : new Date(tb.startsAt.getTime() + i * 3600 * 1000),
          } as any,
        });
        matchesCreated++;
        mIdx++;
      }
    }
    // open / prepared / draft / cancelled: no matches generated.

    // Write participants (with before/after ratings + final positions for completed)
    for (let seedIdx = 0; seedIdx < sortedParticipants.length; seedIdx++) {
      const p = sortedParticipants[seedIdx];
      const pre = preRatings.get(p.id)!;
      const finalPosition = finalPositions.get(p.id);

      const ratingAfter = tb.status === TournamentStatus.completed ? p.rating : null;
      const rdAfter = tb.status === TournamentStatus.completed ? p.rd : null;
      const delta =
        tb.status === TournamentStatus.completed ? Math.round(p.rating - pre.rating) : null;

      // For groups_playoff: assign a group letter to participants in completed tournaments
      let groupLetter: string | null = null;
      let groupRank: number | null = null;
      if (tb.format === TournamentFormat.groups_playoff && tb.groupCount) {
        const perGroup = Math.ceil(sortedParticipants.length / tb.groupCount);
        const gIdx = Math.floor(seedIdx / perGroup);
        groupLetter = String.fromCharCode(65 + gIdx); // A, B, C, ...
        groupRank = (seedIdx % perGroup) + 1;
      }

      await prisma.tournamentParticipant.upsert({
        where: { tournamentId_playerId: { tournamentId: tb.id, playerId: p.id } },
        update: {},
        create: {
          tournamentId: tb.id,
          playerId: p.id,
          seed: seedIdx + 1,
          finalPosition: finalPosition ?? null,
          ratingBefore: pre.rating,
          rdBefore: pre.rd,
          ratingAfter,
          rdAfter,
          ratingDeltaDisplay: delta,
          groupLetter,
          groupRank,
        },
      });
      participantsCreated++;

      // RatingChange + tournamentsPlayed bump for completed
      if (tb.status === TournamentStatus.completed) {
        await prisma.ratingChange.create({
          data: {
            playerId: p.id,
            tournamentId: tb.id,
            ratingBefore: pre.rating,
            ratingAfter: p.rating,
            rdBefore: pre.rd,
            rdAfter: p.rd,
            changeType: RatingChangeType.tournament,
            formulaVersion: 'glicko1-v1',
            coefficientsSnapshot: { tau: 0.5 },
            reason: `Tournament: ${tb.title}`,
          },
        });
        ratingChangesCreated++;
        p.tournamentsPlayed += 1;
      }
    }

    if (tb.status === TournamentStatus.completed) {
      // Update player rows with new ratings + tournamentsPlayed
      for (const p of sortedParticipants) {
        await prisma.player.update({
          where: { id: p.id },
          data: {
            internalRating: p.rating,
            rd: p.rd,
            tournamentsPlayed: p.tournamentsPlayed,
            provisional: p.tournamentsPlayed < 5,
            ratingConfidence:
              p.rd < 80
                ? RatingConfidence.high
                : p.rd < 130
                  ? RatingConfidence.medium
                  : RatingConfidence.low,
          },
        });
      }
    }
  }

  // Snapshot final ratings
  for (const p of players) p.finalRating = p.rating;

  console.log(
    `[seed-large] Tournaments: ${tournamentBlueprint.length} ` +
      `(completed=${tournamentStatusCounts.completed}, in_progress=${tournamentStatusCounts.in_progress}, ` +
      `open=${tournamentStatusCounts.open}, prepared=${tournamentStatusCounts.prepared}, ` +
      `draft=${tournamentStatusCounts.draft}, cancelled=${tournamentStatusCounts.cancelled})`,
  );
  console.log(`[seed-large] Matches: ${matchesCreated}, Participants: ${participantsCreated}, RatingChanges: ${ratingChangesCreated}`);

  // -----------------------------------------------------------------------
  // Casual matches
  // -----------------------------------------------------------------------
  const casualCount = 80;
  let casualsCreated = 0;
  for (let i = 0; i < casualCount; i++) {
    const p1 = randChoice(players);
    const candidates = players.filter(
      (p) => p.id !== p1.id && Math.abs(p.finalRating - p1.finalRating) <= 300,
    );
    if (candidates.length === 0) continue;
    const p2 = randChoice(candidates);
    const playedAt = addDays(today, -randInt(1, 180));
    const matchId = `synth-casual-${pad(i + 1, 4)}`;
    const fmt = MatchFormat.bo5;
    // higher rated usually wins; 30% upset for casuals
    const upset = rng() < 0.3;
    const higher = p1.finalRating >= p2.finalRating ? p1 : p2;
    const lower = higher.id === p1.id ? p2 : p1;
    const winner = upset ? lower : higher;
    const loser = winner.id === p1.id ? p2 : p1;
    const score = pickSetScore(fmt, upset);
    const player1IsWinner = winner.id === p1.id;

    await prisma.match.upsert({
      where: { id: matchId },
      update: {},
      create: {
        id: matchId,
        tournamentId: null,
        matchType: MatchType.casual,
        round: 0,
        player1Id: p1.id,
        player2Id: p2.id,
        winnerId: winner.id,
        setsPlayer1: player1IsWinner ? score.winner : score.loser,
        setsPlayer2: player1IsWinner ? score.loser : score.winner,
        status: MatchStatus.confirmed,
        playedAt,
        confirmedAt: playedAt,
      } as any,
    });
    // Tiny rating change record for casuals (weight 0.3)
    void winner; void loser;
    casualsCreated++;
  }
  console.log(`[seed-large] Casual matches: ${casualsCreated}`);

  // -----------------------------------------------------------------------
  // Rating snapshots (monthly, walking back from current)
  // -----------------------------------------------------------------------
  // Build per-player month-by-month rating array, then compute ranks per month.
  const months: Date[] = [];
  for (let m = CFG.snapshotMonths - 1; m >= 0; m--) {
    const d = startOfDayUTC(addMonths(today, -m));
    d.setUTCDate(1); // first of month
    months.push(d);
  }

  // For each player, walk backwards: monthN = current; monthN-1 = monthN ± drift; etc.
  const playerMonthRatings = new Map<string, number[]>();
  const playerMonthRDs = new Map<string, number[]>();
  for (const p of players) {
    const ratings: number[] = new Array(months.length);
    const rds: number[] = new Array(months.length);
    ratings[months.length - 1] = p.finalRating;
    rds[months.length - 1] = p.rd;
    for (let i = months.length - 2; i >= 0; i--) {
      const drift = rng() < 0.25 ? 0 : Math.round(randNormal(0, 30));
      // walking BACKWARD in time: previous = next - drift
      ratings[i] = clamp(Math.round(ratings[i + 1] - drift), 1200, 2400);
      rds[i] = clamp(Math.round(rds[i + 1] + randInt(-2, 5)), 50, 350);
    }
    playerMonthRatings.set(p.id, ratings);
    playerMonthRDs.set(p.id, rds);
  }

  // Insert snapshots month-by-month, compute rankOverall on the fly
  let snapshotsCreated = 0;
  for (let mIdx = 0; mIdx < months.length; mIdx++) {
    const d = months[mIdx];
    // Compute rank ordering for this month
    const monthly = players
      .map((p) => ({ id: p.id, rating: playerMonthRatings.get(p.id)![mIdx] }))
      .sort((a, b) => b.rating - a.rating);
    const rankById = new Map<string, number>();
    monthly.forEach((m, i) => rankById.set(m.id, i + 1));

    // Bulk insert via createMany (skipDuplicates handles re-runs)
    const batch = players.map((p) => ({
      playerId: p.id,
      snapshotDate: d,
      rating: playerMonthRatings.get(p.id)![mIdx],
      rd: playerMonthRDs.get(p.id)![mIdx],
      rankOverall: rankById.get(p.id) ?? null,
      rankCategory: null as number | null,
    }));
    const res = await prisma.ratingSnapshot.createMany({ data: batch, skipDuplicates: true });
    snapshotsCreated += res.count;
  }
  console.log(`[seed-large] Rating snapshots: ${snapshotsCreated}`);

  // -----------------------------------------------------------------------
  // Refresh leaderboard materialized view
  // -----------------------------------------------------------------------
  try {
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard`;
  } catch (e) {
    console.warn('[seed-large] Could not refresh leaderboard view:', (e as Error).message);
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `[seed-large] Done in ${elapsed}s. Seeded ${clubs.length} clubs, ${players.length} players, ` +
      `${tournamentBlueprint.length} tournaments ` +
      `(${tournamentStatusCounts.completed}/${tournamentStatusCounts.in_progress}/` +
      `${tournamentStatusCounts.open + tournamentStatusCounts.prepared}/` +
      `${tournamentStatusCounts.draft}/${tournamentStatusCounts.cancelled}), ` +
      `${matchesCreated} matches, ${casualsCreated} casual matches, ` +
      `${snapshotsCreated} rating snapshots, ${ratingChangesCreated} rating changes.`,
  );
}

// -----------------------------------------------------------------------------
// Format runners
// -----------------------------------------------------------------------------

interface TBlueprint {
  id: string;
  title: string;
  matchFormat: MatchFormat;
  startsAt: Date;
  size: number;
  groupCount?: number;
}

async function persistMatch(
  tb: TBlueprint,
  round: number,
  matchSeq: number,
  p1: PlayerState,
  p2: PlayerState,
  winner: PlayerState,
  setsP1: number,
  setsP2: number,
  playedAt: Date,
  bracketLabel?: string,
  groupLetter?: string,
): Promise<void> {
  const tIdx = tb.id.replace('synth-tournament-', 't');
  const matchId = `synth-match-${tIdx}-r${pad(round, 2)}-m${pad(matchSeq, 2)}`;
  await prisma.match.upsert({
    where: { id: matchId },
    update: {},
    create: {
      id: matchId,
      tournamentId: tb.id,
      matchType: MatchType.tournament,
      round,
      player1Id: p1.id,
      player2Id: p2.id,
      winnerId: winner.id,
      setsPlayer1: setsP1,
      setsPlayer2: setsP2,
      status: MatchStatus.completed,
      playedAt,
      bracketLabel: bracketLabel ?? null,
      groupLetter: groupLetter ?? null,
    } as any,
  });
}

function decideWinner(p1: PlayerState, p2: PlayerState): { winner: PlayerState; loser: PlayerState; upset: boolean } {
  // Higher rated = favorite. Upset rate ~25%, weighted by rating gap (smaller gap => more likely).
  const favorite = p1.rating >= p2.rating ? p1 : p2;
  const underdog = favorite.id === p1.id ? p2 : p1;
  const gap = Math.abs(p1.rating - p2.rating);
  // Map gap [0..600] to upset prob [0.40 .. 0.08]
  const baseUpset = clamp(0.4 - (gap / 600) * 0.32, 0.05, 0.45);
  const upset = rng() < baseUpset;
  return upset ? { winner: underdog, loser: favorite, upset: true } : { winner: favorite, loser: underdog, upset: false };
}

async function runSingleElim(
  tb: TBlueprint,
  participants: PlayerState[],
  finalPositions: Map<string, number>,
  onMatch: () => void,
): Promise<void> {
  // Standard seeded bracket: seed 1 vs N, 2 vs N-1, etc.
  const N = participants.length;
  const seeds = participants.slice();
  // Build first-round pairings
  let bracket: PlayerState[] = [];
  for (let i = 0; i < N / 2; i++) {
    bracket.push(seeds[i], seeds[N - 1 - i]);
  }

  let round = 1;
  let matchSeq = 1;
  const totalRounds = Math.log2(N);
  // Track losers for placing
  const losersByRound: PlayerState[][] = [];

  let currentRoundPlayers = bracket;
  while (currentRoundPlayers.length > 1) {
    const winners: PlayerState[] = [];
    const losers: PlayerState[] = [];
    for (let i = 0; i < currentRoundPlayers.length; i += 2) {
      const p1 = currentRoundPlayers[i];
      const p2 = currentRoundPlayers[i + 1];
      const { winner, loser, upset } = decideWinner(p1, p2);
      const score = pickSetScore(tb.matchFormat, upset);
      // Apply rating update
      applyRatingUpdate(winner, loser);
      const playedAt = new Date(tb.startsAt.getTime() + (round - 1) * 2 * 3600 * 1000 + i * 600 * 1000);
      const setsP1 = winner.id === p1.id ? score.winner : score.loser;
      const setsP2 = winner.id === p1.id ? score.loser : score.winner;
      await persistMatch(tb, round, matchSeq++, p1, p2, winner, setsP1, setsP2, playedAt, 'Main');
      onMatch();
      winners.push(winner);
      losers.push(loser);
    }
    losersByRound.push(losers);
    currentRoundPlayers = winners;
    round++;
  }

  // currentRoundPlayers[0] is champion
  const champion = currentRoundPlayers[0];
  finalPositions.set(champion.id, 1);
  // Runner-up = loser of final round
  if (losersByRound.length > 0) {
    const runnerUp = losersByRound[losersByRound.length - 1][0];
    finalPositions.set(runnerUp.id, 2);
  }
  // Semifinal losers => 3 / 4 (tied)
  if (losersByRound.length >= 2) {
    const sfLosers = losersByRound[losersByRound.length - 2];
    sfLosers.forEach((p) => finalPositions.set(p.id, 3));
  }
  // Earlier-round losers — tie at 2^(rounds-r-1)+1
  for (let r = 0; r < losersByRound.length - 2; r++) {
    const pos = Math.pow(2, totalRounds - r - 1) + 1;
    losersByRound[r].forEach((p) => finalPositions.set(p.id, pos));
  }
}

async function runRoundRobin(
  tb: TBlueprint,
  participants: PlayerState[],
  finalPositions: Map<string, number>,
  onMatch: () => void,
): Promise<void> {
  const N = participants.length;
  const wins = new Map<string, number>();
  const setDiff = new Map<string, number>();
  participants.forEach((p) => { wins.set(p.id, 0); setDiff.set(p.id, 0); });

  let matchSeq = 1;
  const round = 1; // single phase
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const p1 = participants[i];
      const p2 = participants[j];
      const { winner, loser, upset } = decideWinner(p1, p2);
      const score = pickSetScore(tb.matchFormat, upset);
      applyRatingUpdate(winner, loser);
      const playedAt = new Date(tb.startsAt.getTime() + (matchSeq - 1) * 30 * 60 * 1000);
      const setsP1 = winner.id === p1.id ? score.winner : score.loser;
      const setsP2 = winner.id === p1.id ? score.loser : score.winner;
      await persistMatch(tb, round, matchSeq++, p1, p2, winner, setsP1, setsP2, playedAt, 'RR');
      onMatch();
      wins.set(winner.id, (wins.get(winner.id) ?? 0) + 1);
      setDiff.set(winner.id, (setDiff.get(winner.id) ?? 0) + (score.winner - score.loser));
      setDiff.set(loser.id, (setDiff.get(loser.id) ?? 0) - (score.winner - score.loser));
    }
  }
  // Rank by wins desc, then setDiff desc
  const ranked = participants
    .slice()
    .sort((a, b) => {
      const w = (wins.get(b.id) ?? 0) - (wins.get(a.id) ?? 0);
      if (w !== 0) return w;
      return (setDiff.get(b.id) ?? 0) - (setDiff.get(a.id) ?? 0);
    });
  ranked.forEach((p, idx) => finalPositions.set(p.id, idx + 1));
}

async function runGroupsPlayoff(
  tb: TBlueprint,
  participants: PlayerState[],
  finalPositions: Map<string, number>,
  onMatch: () => void,
): Promise<void> {
  const groupCount = tb.groupCount ?? 4;
  const perGroup = Math.ceil(participants.length / groupCount);
  // Distribute via "snake" so each group has mix of seeds
  const groups: PlayerState[][] = Array.from({ length: groupCount }, () => []);
  for (let i = 0; i < participants.length; i++) {
    const cycle = Math.floor(i / groupCount);
    const idxInCycle = i % groupCount;
    const gIdx = cycle % 2 === 0 ? idxInCycle : groupCount - 1 - idxInCycle;
    groups[gIdx].push(participants[i]);
  }

  let matchSeq = 1;
  // Group stage (round 1)
  const groupStandings: PlayerState[][] = [];
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    const wins = new Map<string, number>();
    grp.forEach((p) => wins.set(p.id, 0));
    for (let i = 0; i < grp.length; i++) {
      for (let j = i + 1; j < grp.length; j++) {
        const p1 = grp[i];
        const p2 = grp[j];
        const { winner, loser, upset } = decideWinner(p1, p2);
        const score = pickSetScore(tb.matchFormat, upset);
        applyRatingUpdate(winner, loser);
        const playedAt = new Date(tb.startsAt.getTime() + (matchSeq - 1) * 30 * 60 * 1000);
        const setsP1 = winner.id === p1.id ? score.winner : score.loser;
        const setsP2 = winner.id === p1.id ? score.loser : score.winner;
        const groupLetter = String.fromCharCode(65 + g);
        await persistMatch(tb, 1, matchSeq++, p1, p2, winner, setsP1, setsP2, playedAt, `G${groupLetter}`, groupLetter);
        onMatch();
        wins.set(winner.id, (wins.get(winner.id) ?? 0) + 1);
      }
    }
    const standing = grp.slice().sort((a, b) => (wins.get(b.id) ?? 0) - (wins.get(a.id) ?? 0));
    groupStandings.push(standing);
  }

  // Playoff: top 2 of each group => single elim
  const koPlayersRaw: PlayerState[] = [];
  groupStandings.forEach((s) => {
    if (s[0]) koPlayersRaw.push(s[0]);
    if (s[1]) koPlayersRaw.push(s[1]);
  });

  // Trim to nearest power of 2 so the bracket has clean rounds.
  let safeCount = 1;
  while (safeCount * 2 <= koPlayersRaw.length) safeCount *= 2;
  const koPlayers = koPlayersRaw.slice(0, safeCount);

  // Bracket pairing (1A vs 2B, 1B vs 2A pattern simplified)
  let bracket: PlayerState[] = [];
  const half = koPlayers.length / 2;
  for (let i = 0; i < half; i++) {
    bracket.push(koPlayers[i], koPlayers[koPlayers.length - 1 - i]);
  }

  let round = 2;
  const losersByRound: PlayerState[][] = [];
  let current = bracket;
  while (current.length > 1) {
    const winners: PlayerState[] = [];
    const losers: PlayerState[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const p1 = current[i];
      const p2 = current[i + 1];
      const { winner, loser, upset } = decideWinner(p1, p2);
      const score = pickSetScore(tb.matchFormat, upset);
      applyRatingUpdate(winner, loser);
      const playedAt = new Date(tb.startsAt.getTime() + 6 * 3600 * 1000 + (matchSeq - 1) * 20 * 60 * 1000);
      const setsP1 = winner.id === p1.id ? score.winner : score.loser;
      const setsP2 = winner.id === p1.id ? score.loser : score.winner;
      await persistMatch(tb, round, matchSeq++, p1, p2, winner, setsP1, setsP2, playedAt, `KO-R${round}`);
      onMatch();
      winners.push(winner);
      losers.push(loser);
    }
    losersByRound.push(losers);
    current = winners;
    round++;
  }

  const champion = current[0];
  if (champion) finalPositions.set(champion.id, 1);
  if (losersByRound.length > 0) {
    const runnerUp = losersByRound[losersByRound.length - 1][0];
    if (runnerUp) finalPositions.set(runnerUp.id, 2);
  }
  if (losersByRound.length >= 2) {
    losersByRound[losersByRound.length - 2].forEach((p) => finalPositions.set(p.id, 3));
  }
  // Group-stage non-advancers: position based on group rank (3rd+ in group => 9+)
  groupStandings.forEach((s) => {
    s.slice(2).forEach((p, idx) => {
      if (!finalPositions.has(p.id)) finalPositions.set(p.id, koPlayers.length + 1 + idx);
    });
  });
}

main()
  .catch((e) => {
    console.error('[seed-large] FAILED:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
