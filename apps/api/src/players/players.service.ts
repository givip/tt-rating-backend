import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreatePlayerDto, PlayerListQuery } from '@tt-rating/types';

const SELF_RATING_MAP = {
  beginner:    { rating: 300,  rd: 350 },
  amateur:     { rating: 500,  rd: 350 },
  experienced: { rating: 700,  rd: 350 },
  ranked:      { rating: 900,  rd: 300 },
} as const;

@Injectable()
export class PlayersService {
  constructor(private prisma: PrismaService) {}

  getSelfRatingStartingValues(selfRating: keyof typeof SELF_RATING_MAP) {
    return SELF_RATING_MAP[selfRating];
  }

  async findAll(query: Partial<PlayerListQuery> & { page: number; limit: number }) {
    const { page, limit, city, gender, search } = query;
    const skip = (page - 1) * limit;

    const where = {
      isActive: true,
      ...(city && { city }),
      ...(gender && { gender }),
      ...(search && {
        OR: [
          { firstNameEn: { contains: search, mode: 'insensitive' as const } },
          { lastNameEn: { contains: search, mode: 'insensitive' as const } },
          { firstNameKa: { contains: search } },
          { lastNameKa: { contains: search } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.player.findMany({
        where,
        orderBy: { internalRating: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, firstNameKa: true, lastNameKa: true,
          firstNameEn: true, lastNameEn: true,
          internalRating: true, rd: true, provisional: true,
          tournamentsPlayed: true, city: true,
        },
      }),
      this.prisma.player.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const player = await this.prisma.player.findUnique({
      where: { id },
      include: {
        ratingSnapshots: {
          orderBy: { snapshotDate: 'asc' },
          take: 52,
        },
        club: { select: { id: true, nameKa: true, nameEn: true } },
      },
    });
    if (!player) throw new NotFoundException('Player not found');
    return player;
  }

  async create(userId: string, dto: CreatePlayerDto) {
    const { selfRating, birthDate, ...rest } = dto;
    const { rating, rd } = selfRating
      ? this.getSelfRatingStartingValues(selfRating)
      : { rating: 1500, rd: 350 };

    return this.prisma.player.create({
      data: {
        ...rest,
        userId,
        internalRating: rating,
        rd,
        ...(birthDate && { birthDate: new Date(birthDate) }),
      },
    });
  }

  async playerTournaments(playerId: string, params: { page: number; limit: number }) {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.tournamentParticipant.findMany({
        where: { playerId },
        orderBy: { tournament: { startsAt: 'desc' } },
        skip,
        take: limit,
        include: {
          tournament: {
            select: { id: true, title: true, format: true, startsAt: true, status: true, participantsCount: true },
          },
        },
      }),
      this.prisma.tournamentParticipant.count({ where: { playerId } }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async playerMatches(playerId: string, params: { page: number; limit: number; since?: string }) {
    const { page, limit, since } = params;
    const skip = (page - 1) * limit;
    const sinceDate = since ? new Date(since) : undefined;

    const where = {
      OR: [{ player1Id: playerId }, { player2Id: playerId }],
      status: 'completed' as const,
      matchType: { in: ['tournament', 'casual'] as const },
      ...(sinceDate ? { playedAt: { gte: sinceDate } } : {}),
    };

    const [matches, total] = await Promise.all([
      this.prisma.match.findMany({
        where,
        orderBy: { playedAt: 'desc' },
        skip,
        take: limit,
        include: {
          player1: { select: { id: true, firstNameKa: true, lastNameKa: true, firstNameEn: true, lastNameEn: true, internalRating: true } },
          player2: { select: { id: true, firstNameKa: true, lastNameKa: true, firstNameEn: true, lastNameEn: true, internalRating: true } },
          tournament: { select: { id: true, title: true } },
        },
      }),
      this.prisma.match.count({ where }),
    ]);

    const data = matches.map((m) => {
      const isP1 = m.player1Id === playerId;
      const opponent = isP1 ? m.player2 : m.player1;
      const myScore = isP1 ? m.setsPlayer1 : m.setsPlayer2;
      const theirScore = isP1 ? m.setsPlayer2 : m.setsPlayer1;
      return {
        matchId: m.id,
        matchType: m.matchType,
        playedAt: m.playedAt,
        opponentId: opponent?.id ?? null,
        opponent: opponent ?? null,
        score: myScore != null && theirScore != null ? `${myScore}:${theirScore}` : null,
        outcome: m.winnerId === playerId ? 'W' : 'L',
        tournamentId: m.tournamentId ?? null,
        tournamentTitle: m.tournament?.title ?? null,
      };
    });

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }
}
