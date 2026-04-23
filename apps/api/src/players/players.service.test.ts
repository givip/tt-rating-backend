import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PlayersService } from './players.service';

const mockPrisma = {
  player: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
};

describe('PlayersService', () => {
  let service: PlayersService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlayersService(mockPrisma as any);
  });

  describe('getSelfRatingStartingValues', () => {
    it('beginner → rating 300, RD 350', () => {
      const result = service.getSelfRatingStartingValues('beginner');
      expect(result).toEqual({ rating: 300, rd: 350 });
    });
    it('amateur → rating 500, RD 350', () => {
      const result = service.getSelfRatingStartingValues('amateur');
      expect(result).toEqual({ rating: 500, rd: 350 });
    });
    it('experienced → rating 700, RD 350', () => {
      const result = service.getSelfRatingStartingValues('experienced');
      expect(result).toEqual({ rating: 700, rd: 350 });
    });
    it('ranked → rating 900, RD 300', () => {
      const result = service.getSelfRatingStartingValues('ranked');
      expect(result).toEqual({ rating: 900, rd: 300 });
    });
  });

  describe('findAll', () => {
    it('returns paginated result with data and meta', async () => {
      mockPrisma.player.findMany.mockResolvedValue([{ id: '1', internalRating: 1600 }]);
      mockPrisma.player.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 50 });

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 50, totalPages: 1 });
    });

    it('calculates correct totalPages', async () => {
      mockPrisma.player.findMany.mockResolvedValue([]);
      mockPrisma.player.count.mockResolvedValue(151);

      const result = await service.findAll({ page: 1, limit: 50 });
      expect(result.meta.totalPages).toBe(4); // ceil(151/50)
    });

    it('applies skip based on page number', async () => {
      mockPrisma.player.findMany.mockResolvedValue([]);
      mockPrisma.player.count.mockResolvedValue(0);

      await service.findAll({ page: 3, limit: 50 });

      expect(mockPrisma.player.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 50 }),
      );
    });
  });

  describe('findOne', () => {
    it('returns player when found', async () => {
      mockPrisma.player.findUnique.mockResolvedValue({ id: 'p1', firstNameKa: 'გიორგი' });
      const result = await service.findOne('p1');
      expect(result.id).toBe('p1');
    });

    it('throws NotFoundException when player not found', async () => {
      mockPrisma.player.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('uses self-rating starting values when selfRating provided', async () => {
      mockPrisma.player.create.mockResolvedValue({ id: 'new-player' });

      await service.create('user-1', {
        firstNameKa: 'გიორგი', lastNameKa: 'კვარაცხელია',
        firstNameEn: 'Giorgi', lastNameEn: 'Kvaratskhelia',
        gender: 'M', selfRating: 'amateur',
      });

      expect(mockPrisma.player.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ internalRating: 500, rd: 350 }),
        }),
      );
    });

    it('uses default rating 1500/350 when no selfRating provided', async () => {
      mockPrisma.player.create.mockResolvedValue({ id: 'new-player' });

      await service.create('user-1', {
        firstNameKa: 'თამარ', lastNameKa: 'მეფე',
        firstNameEn: 'Tamar', lastNameEn: 'Mepe',
        gender: 'F',
      });

      expect(mockPrisma.player.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ internalRating: 1500, rd: 350 }),
        }),
      );
    });
  });
});
