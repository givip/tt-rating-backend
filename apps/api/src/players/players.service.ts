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
}
