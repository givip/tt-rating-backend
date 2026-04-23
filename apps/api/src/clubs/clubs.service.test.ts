import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ClubsService } from './clubs.service';

const mockPrisma = {
  club: { findMany: vi.fn(), findUnique: vi.fn() },
};

describe('ClubsService', () => {
  let service: ClubsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClubsService(mockPrisma as any);
  });

  describe('findAll', () => {
    it('returns all clubs ordered by English name', async () => {
      const clubs = [
        { id: 'c1', nameKa: 'დინამო', nameEn: 'Dynamo', city: 'Kutaisi' },
        { id: 'c2', nameKa: 'პროსპინი', nameEn: 'ProSpin', city: 'Tbilisi' },
      ];
      mockPrisma.club.findMany.mockResolvedValue(clubs);
      const result = await service.findAll();
      expect(result).toEqual(clubs);
      expect(mockPrisma.club.findMany).toHaveBeenCalledWith({
        select: { id: true, nameKa: true, nameEn: true, city: true },
        orderBy: { nameEn: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns club with players', async () => {
      const club = { id: 'c1', nameKa: 'პროსპინი', nameEn: 'ProSpin', city: 'Tbilisi', players: [] };
      mockPrisma.club.findUnique.mockResolvedValue(club);
      const result = await service.findOne('c1');
      expect(result).toEqual(club);
    });

    it('throws NotFoundException when club not found', async () => {
      mockPrisma.club.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
