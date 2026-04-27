import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ClubsService } from './clubs.service';

const mockPrisma = {
  club: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
};

describe('ClubsService', () => {
  let service: ClubsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClubsService(mockPrisma as any);
  });

  describe('findAll', () => {
    it('returns clubs with memberCount sorted by member count desc', async () => {
      mockPrisma.club.findMany.mockResolvedValue([
        { id: 'c1', nameKa: 'სპინი', nameEn: 'Spin', city: 'Tbilisi', _count: { players: 12 } },
        { id: 'c2', nameKa: 'ასო', nameEn: 'ASO', city: 'Batumi', _count: { players: 5 } },
      ]);
      const result = await service.findAll();
      expect(result[0].memberCount).toBe(12);
      expect(result[1].memberCount).toBe(5);
    });
  });

  describe('findOne', () => {
    it('returns club with members and tournaments hosted', async () => {
      mockPrisma.club.findUnique.mockResolvedValue({
        id: 'c1', nameKa: 'სპინი', nameEn: 'Spin', city: 'Tbilisi', address: null, phone: null, createdAt: new Date(),
        players: [{ id: 'p1', firstNameKa: 'ა', lastNameKa: 'ბ', firstNameEn: 'A', lastNameEn: 'B', internalRating: 1520, provisional: false }],
        tournaments: [{ id: 't1', title: 'Club Cup', status: 'completed', startsAt: new Date(), format: 'groups_playoff' }],
        _count: { players: 1 },
      });
      const result = await service.findOne('c1');
      expect(result.memberCount).toBe(1);
      expect(result.tournaments).toHaveLength(1);
    });

    it('throws NotFoundException for unknown club', async () => {
      mockPrisma.club.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad')).rejects.toThrow('Club not found');
    });
  });
});
