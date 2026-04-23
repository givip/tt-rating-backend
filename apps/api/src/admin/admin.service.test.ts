import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(() => {
    service = new AdminService({} as any);
  });

  describe('parseCsvRow', () => {
    const validRow = {
      first_name_ka: 'გიორგი',
      last_name_ka: 'კვარაცხელია',
      first_name_en: 'Giorgi',
      last_name_en: 'Kvaratskhelia',
      gender: 'M',
      rating: '1650',
      rd: '200',
      source: 'imported_rttf',
    };

    it('parses a valid row into player data', () => {
      const result = service.parseCsvRow(validRow);
      expect(result.firstNameKa).toBe('გიორგი');
      expect(result.firstNameEn).toBe('Giorgi');
      expect(result.internalRating).toBe(1650);
      expect(result.rd).toBe(200);
      expect(result.ratingSource).toBe('imported_rttf');
    });

    it('throws on invalid gender', () => {
      expect(() =>
        service.parseCsvRow({ ...validRow, gender: 'X' }),
      ).toThrow();
    });

    it('throws on missing required field', () => {
      const { first_name_ka: _, ...incomplete } = validRow;
      expect(() => service.parseCsvRow(incomplete as any)).toThrow();
    });

    it('coerces rating and rd to numbers', () => {
      const result = service.parseCsvRow({ ...validRow, rating: '1750.5', rd: '125' });
      expect(result.internalRating).toBe(1750.5);
      expect(result.rd).toBe(125);
    });

    it('accepts optional rttf_id and city', () => {
      const result = service.parseCsvRow({ ...validRow, rttf_id: 'rttf-123', city: 'Tbilisi' });
      expect(result.rttfId).toBe('rttf-123');
      expect(result.city).toBe('Tbilisi');
    });
  });

  describe('validateImportRow', () => {
    it('rejects rating below 0', () => {
      expect(() =>
        service.parseCsvRow({ ...{
          first_name_ka: 'A', last_name_ka: 'B',
          first_name_en: 'A', last_name_en: 'B',
          gender: 'M', source: 'manual',
        }, rating: '-10', rd: '200' }),
      ).toThrow();
    });

    it('rejects RD above 350', () => {
      expect(() =>
        service.parseCsvRow({ ...{
          first_name_ka: 'A', last_name_ka: 'B',
          first_name_en: 'A', last_name_en: 'B',
          gender: 'M', source: 'manual',
        }, rating: '1500', rd: '400' }),
      ).toThrow();
    });
  });
});
