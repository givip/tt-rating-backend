import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class ClubsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const clubs = await this.prisma.club.findMany({
      select: {
        id: true, nameKa: true, nameEn: true, city: true,
        _count: { select: { players: { where: { isActive: true } } } },
      },
      orderBy: { players: { _count: 'desc' } },
    });
    return clubs.map((c) => ({ ...c, memberCount: c._count.players, _count: undefined }));
  }

  async findOne(id: string) {
    const club = await this.prisma.club.findUnique({
      where: { id },
      include: {
        players: {
          where: { isActive: true },
          select: {
            id: true, firstNameKa: true, lastNameKa: true,
            firstNameEn: true, lastNameEn: true,
            internalRating: true, provisional: true,
          },
          orderBy: { internalRating: 'desc' },
          take: 50,
        },
        tournaments: {
          select: { id: true, title: true, status: true, startsAt: true, format: true },
          orderBy: { startsAt: 'desc' },
          take: 20,
        },
        _count: { select: { players: { where: { isActive: true } } } },
      },
    });
    if (!club) throw new NotFoundException('Club not found');
    return { ...club, memberCount: club._count.players, _count: undefined };
  }
}
