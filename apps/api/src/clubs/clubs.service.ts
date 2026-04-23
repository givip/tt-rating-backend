import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class ClubsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.club.findMany({
      select: { id: true, nameKa: true, nameEn: true, city: true },
      orderBy: { nameEn: 'asc' },
    });
  }

  async findOne(id: string) {
    const club = await this.prisma.club.findUnique({
      where: { id },
      include: { players: { select: { id: true, firstNameKa: true, lastNameKa: true } } },
    });
    if (!club) throw new NotFoundException('Club not found');
    return club;
  }
}
