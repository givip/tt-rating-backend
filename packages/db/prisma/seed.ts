import * as bcrypt from 'bcrypt';
import { PrismaClient, Gender, RatingConfidence, UserRole, TournamentFormat, MatchFormat, TournamentCategory, TournamentStatus, MatchStatus, RatingChangeType, PlayingHand } from '../generated';

const prisma = new PrismaClient();

// Mirrors MIN_BCRYPT_COST in apps/api/src/auth/strategies/password.strategy.ts.
// Keep in sync; seed cannot import from apps/api without a cycle.
const SEED_BCRYPT_COST = 12;
const DEV_ADMIN_PASSWORD = 'dev-admin-password';

async function main() {
  console.log('Seeding database...');

  // --- Clubs ---
  const [prospin, ttbilisi, dynamo] = await Promise.all([
    prisma.club.upsert({
      where: { id: 'club-prospin' },
      update: {},
      create: { id: 'club-prospin', nameKa: 'პროსპინი', nameEn: 'ProSpin', city: 'Tbilisi' },
    }),
    prisma.club.upsert({
      where: { id: 'club-ttbilisi' },
      update: {},
      create: { id: 'club-ttbilisi', nameKa: 'თბილისი TT', nameEn: 'Tbilisi TT', city: 'Tbilisi' },
    }),
    prisma.club.upsert({
      where: { id: 'club-dynamo' },
      update: {},
      create: { id: 'club-dynamo', nameKa: 'დინამო', nameEn: 'Dynamo', city: 'Kutaisi' },
    }),
  ]);

  // --- Users + Players ---
  const playerData: Array<{
    id: string; phone: string; firstNameKa: string; lastNameKa: string; firstNameEn: string; lastNameEn: string;
    gender: Gender; city: string; clubId: string | null; rating: number; rd: number; provisional: boolean; tournamentsPlayed: number;
    birthDate?: Date; racket?: string | null; playingHand?: PlayingHand;
  }> = [
    { id: 'user-lasha', phone: '+995551000001', firstNameKa: 'ლაშა', lastNameKa: 'ბერიძე', firstNameEn: 'Lasha', lastNameEn: 'Beridze', gender: Gender.M, city: 'Tbilisi', clubId: prospin.id, rating: 2150, rd: 65, provisional: false, tournamentsPlayed: 24, birthDate: new Date('1992-04-12'), racket: 'Butterfly Viscaria', playingHand: PlayingHand.right },
    { id: 'user-giorgi', phone: '+995551000002', firstNameKa: 'გიორგი', lastNameKa: 'კვარაცხელია', firstNameEn: 'Giorgi', lastNameEn: 'Kvaratskhelia', gender: Gender.M, city: 'Tbilisi', clubId: prospin.id, rating: 2080, rd: 72, provisional: false, tournamentsPlayed: 18, birthDate: new Date('1995-09-03'), racket: 'Stiga Carbonado', playingHand: PlayingHand.left },
    { id: 'user-nino', phone: '+995551000003', firstNameKa: 'ნინო', lastNameKa: 'სამადაშვილი', firstNameEn: 'Nino', lastNameEn: 'Samadashvili', gender: Gender.F, city: 'Tbilisi', clubId: ttbilisi.id, rating: 1920, rd: 80, provisional: false, tournamentsPlayed: 15, birthDate: new Date('1998-01-22'), racket: null, playingHand: PlayingHand.right },
    { id: 'user-davit', phone: '+995551000004', firstNameKa: 'დავით', lastNameKa: 'ჩიქოვანი', firstNameEn: 'Davit', lastNameEn: 'Chikovani', gender: Gender.M, city: 'Kutaisi', clubId: dynamo.id, rating: 1850, rd: 95, provisional: false, tournamentsPlayed: 11 },
    { id: 'user-mari', phone: '+995551000005', firstNameKa: 'მარი', lastNameKa: 'ჟღენტი', firstNameEn: 'Mari', lastNameEn: 'Zhghenti', gender: Gender.F, city: 'Tbilisi', clubId: prospin.id, rating: 1780, rd: 110, provisional: false, tournamentsPlayed: 8 },
    { id: 'user-sandro', phone: '+995551000006', firstNameKa: 'სანდრო', lastNameKa: 'გამყრელიძე', firstNameEn: 'Sandro', lastNameEn: 'Gamkrelidze', gender: Gender.M, city: 'Tbilisi', clubId: ttbilisi.id, rating: 1720, rd: 120, provisional: false, tournamentsPlayed: 6 },
    { id: 'user-ana', phone: '+995551000007', firstNameKa: 'ანა', lastNameKa: 'ნიჟარაძე', firstNameEn: 'Ana', lastNameEn: 'Nizharadze', gender: Gender.F, city: 'Batumi', clubId: null, rating: 1650, rd: 135, provisional: false, tournamentsPlayed: 5 },
    { id: 'user-nika', phone: '+995551000008', firstNameKa: 'ნიკა', lastNameKa: 'ხვედელიძე', firstNameEn: 'Nika', lastNameEn: 'Khvedelidze', gender: Gender.M, city: 'Tbilisi', clubId: prospin.id, rating: 1580, rd: 150, provisional: true, tournamentsPlayed: 3 },
    { id: 'user-tamta', phone: '+995551000009', firstNameKa: 'თამთა', lastNameKa: 'ფხაკაძე', firstNameEn: 'Tamta', lastNameEn: 'Pkhakadze', gender: Gender.F, city: 'Tbilisi', clubId: ttbilisi.id, rating: 1520, rd: 180, provisional: true, tournamentsPlayed: 2 },
    { id: 'user-levan', phone: '+995551000010', firstNameKa: 'ლევან', lastNameKa: 'ასათიანი', firstNameEn: 'Levan', lastNameEn: 'Asatiani', gender: Gender.M, city: 'Kutaisi', clubId: dynamo.id, rating: 1500, rd: 200, provisional: true, tournamentsPlayed: 1 },
  ];

  const users: { [key: string]: { id: string; playerId: string } } = {};

  for (const p of playerData) {
    const user = await prisma.user.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        phone: p.phone,
        role: UserRole.player,
      },
    });

    const playerId = `player-${p.id.replace('user-', '')}`;
    await prisma.player.upsert({
      where: { id: playerId },
      update: {},
      create: {
        id: playerId,
        userId: user.id,
        firstNameKa: p.firstNameKa,
        lastNameKa: p.lastNameKa,
        firstNameEn: p.firstNameEn,
        lastNameEn: p.lastNameEn,
        gender: p.gender,
        city: p.city,
        clubId: p.clubId,
        internalRating: p.rating,
        rd: p.rd,
        provisional: p.provisional,
        tournamentsPlayed: p.tournamentsPlayed,
        ratingConfidence: p.provisional ? RatingConfidence.low : RatingConfidence.high,
        isActive: true,
        ...(p.birthDate && { birthDate: p.birthDate }),
        ...(p.racket !== undefined && { racket: p.racket }),
        ...(p.playingHand && { playingHand: p.playingHand }),
      },
    });

    users[p.id] = { id: user.id, playerId };
  }

  // --- Organizer user ---
  const organizer = await prisma.user.upsert({
    where: { id: 'user-organizer' },
    update: {},
    create: {
      id: 'user-organizer',
      phone: '+995551000099',
      email: 'organizer@prospin.ge',
      role: UserRole.organizer,
    },
  });

  // --- Admin user ---
  // Dev-only credentials: admin@ttr.ge / dev-admin-password. NEVER use in
  // production — rotate via the admin tooling before exposing this DB anywhere.
  const adminPasswordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, SEED_BCRYPT_COST);
  console.warn(
    `[seed] Created admin user 'admin@ttr.ge' with dev password '${DEV_ADMIN_PASSWORD}'. ROTATE before production.`,
  );
  await prisma.user.upsert({
    where: { id: 'user-admin' },
    update: { passwordHash: adminPasswordHash },
    create: {
      id: 'user-admin',
      phone: '+995551000000',
      email: 'admin@ttr.ge',
      passwordHash: adminPasswordHash,
      role: UserRole.admin,
    },
  });

  // --- Tournament 1: completed ---
  const t1 = await prisma.tournament.upsert({
    where: { id: 'tournament-spring-open' },
    update: {},
    create: {
      id: 'tournament-spring-open',
      title: 'Spring Open 2026',
      organizerId: organizer.id,
      clubId: prospin.id,
      venueName: 'ProSpin Club',
      address: 'Vazha-Pshavela Ave 45',
      city: 'Tbilisi',
      startsAt: new Date('2026-03-15T10:00:00Z'),
      endsAt: new Date('2026-03-15T20:00:00Z'),
      format: TournamentFormat.single_elim,
      matchFormat: MatchFormat.bo5,
      category: TournamentCategory.open,
      maxParticipants: 16,
      onlineRegistration: true,
      status: TournamentStatus.completed,
      participantsCount: 8,
      processed: true,
    },
  });

  // Participants for t1
  const t1Players = [
    { playerId: users['user-lasha'].playerId, seed: 1, finalPosition: 1, ratingBefore: 2100, rdBefore: 70, ratingAfter: 2150, rdAfter: 65, ratingDeltaDisplay:50 },
    { playerId: users['user-giorgi'].playerId, seed: 2, finalPosition: 2, ratingBefore: 2050, rdBefore: 80, ratingAfter: 2080, rdAfter: 72, ratingDeltaDisplay:30 },
    { playerId: users['user-nino'].playerId, seed: 3, finalPosition: 3, ratingBefore: 1900, rdBefore: 90, ratingAfter: 1920, rdAfter: 80, ratingDeltaDisplay:20 },
    { playerId: users['user-davit'].playerId, seed: 4, finalPosition: 4, ratingBefore: 1870, rdBefore: 100, ratingAfter: 1850, rdAfter: 95, ratingDeltaDisplay:-20 },
    { playerId: users['user-mari'].playerId, seed: 5, finalPosition: 5, ratingBefore: 1800, rdBefore: 120, ratingAfter: 1780, rdAfter: 110, ratingDeltaDisplay:-20 },
    { playerId: users['user-sandro'].playerId, seed: 6, finalPosition: 6, ratingBefore: 1740, rdBefore: 130, ratingAfter: 1720, rdAfter: 120, ratingDeltaDisplay:-20 },
    { playerId: users['user-ana'].playerId, seed: 7, finalPosition: 7, ratingBefore: 1660, rdBefore: 145, ratingAfter: 1650, rdAfter: 135, ratingDeltaDisplay:-10 },
    { playerId: users['user-nika'].playerId, seed: 8, finalPosition: 8, ratingBefore: 1600, rdBefore: 160, ratingAfter: 1580, rdAfter: 150, ratingDeltaDisplay:-20 },
  ];

  for (const tp of t1Players) {
    await prisma.tournamentParticipant.upsert({
      where: { tournamentId_playerId: { tournamentId: t1.id, playerId: tp.playerId } },
      update: {},
      create: { tournamentId: t1.id, ...tp },
    });
  }

  // Matches for t1 (QF + SF + F)
  const t1Matches = [
    // QF
    { id: 'match-t1-qf1', round: 1, p1: users['user-lasha'].playerId, p2: users['user-nika'].playerId, winner: users['user-lasha'].playerId, s1: 3, s2: 0 },
    { id: 'match-t1-qf2', round: 1, p1: users['user-giorgi'].playerId, p2: users['user-ana'].playerId, winner: users['user-giorgi'].playerId, s1: 3, s2: 1 },
    { id: 'match-t1-qf3', round: 1, p1: users['user-nino'].playerId, p2: users['user-sandro'].playerId, winner: users['user-nino'].playerId, s1: 3, s2: 2 },
    { id: 'match-t1-qf4', round: 1, p1: users['user-davit'].playerId, p2: users['user-mari'].playerId, winner: users['user-davit'].playerId, s1: 3, s2: 1 },
    // SF
    { id: 'match-t1-sf1', round: 2, p1: users['user-lasha'].playerId, p2: users['user-davit'].playerId, winner: users['user-lasha'].playerId, s1: 3, s2: 0 },
    { id: 'match-t1-sf2', round: 2, p1: users['user-giorgi'].playerId, p2: users['user-nino'].playerId, winner: users['user-giorgi'].playerId, s1: 3, s2: 2 },
    // F
    { id: 'match-t1-f1', round: 3, p1: users['user-lasha'].playerId, p2: users['user-giorgi'].playerId, winner: users['user-lasha'].playerId, s1: 3, s2: 1 },
  ];

  for (const m of t1Matches) {
    await prisma.match.upsert({
      where: { id: m.id },
      update: {},
      create: {
        id: m.id,
        tournamentId: t1.id,
        round: m.round,
        player1Id: m.p1,
        player2Id: m.p2,
        winnerId: m.winner,
        setsPlayer1: m.s1,
        setsPlayer2: m.s2,
        status: MatchStatus.completed,
        playedAt: new Date('2026-03-15T14:00:00Z'),
      },
    });
  }

  // --- Tournament 2: upcoming ---
  await prisma.tournament.upsert({
    where: { id: 'tournament-summer-cup' },
    update: {},
    create: {
      id: 'tournament-summer-cup',
      title: 'Summer Cup 2026',
      organizerId: organizer.id,
      clubId: ttbilisi.id,
      venueName: 'Tbilisi TT Club',
      address: 'Rustaveli Ave 10',
      city: 'Tbilisi',
      startsAt: new Date('2026-06-20T10:00:00Z'),
      endsAt: new Date('2026-06-20T20:00:00Z'),
      format: TournamentFormat.round_robin,
      matchFormat: MatchFormat.bo5,
      category: TournamentCategory.open,
      maxParticipants: 24,
      onlineRegistration: true,
      registrationDeadline: new Date('2026-06-15T23:59:00Z'),
      status: TournamentStatus.open,
      participantsCount: 4,
      processed: false,
    },
  });

  // --- Rating config ---
  await prisma.ratingConfig.upsert({
    where: { key: 'glicko_tau' },
    update: {},
    create: { key: 'glicko_tau', value: 0.5 },
  });
  await prisma.ratingConfig.upsert({
    where: { key: 'provisional_threshold' },
    update: {},
    create: { key: 'provisional_threshold', value: 5 },
  });
  await prisma.ratingConfig.upsert({
    where: { key: 'casual_weight_multiplier' },
    update: {},
    create: { key: 'casual_weight_multiplier', value: 0.3 },
  });

  // --- Refresh leaderboard materialized view ---
  await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard`;

  console.log('Done. Seeded: 3 clubs, 10 players, 2 tournaments, 7 matches.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
