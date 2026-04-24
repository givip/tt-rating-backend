import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';

const CsvRowSchema = z.object({
  first_name_ka: z.string().min(1),
  last_name_ka: z.string().min(1),
  first_name_en: z.string().min(1),
  last_name_en: z.string().min(1),
  gender: z.enum(['M', 'F']),
  rating: z.coerce.number().min(0).max(4000),
  rd: z.coerce.number().min(30).max(350),
  rttf_id: z.string().optional(),
  birth_date: z.string().optional(),
  city: z.string().optional(),
});

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  parseCsvRow(row: Record<string, string>) {
    const parsed = CsvRowSchema.parse(row);
    return {
      firstNameKa: parsed.first_name_ka,
      lastNameKa: parsed.last_name_ka,
      firstNameEn: parsed.first_name_en,
      lastNameEn: parsed.last_name_en,
      gender: parsed.gender,
      internalRating: parsed.rating,
      rd: parsed.rd,
      rttfId: parsed.rttf_id,
      city: parsed.city,
      birthDate: parsed.birth_date ? new Date(parsed.birth_date) : undefined,
    };
  }

  async bulkImportPlayers(rows: Record<string, string>[]) {
    const results = { created: 0, failed: 0, errors: [] as string[] };

    for (const row of rows) {
      try {
        const playerData = this.parseCsvRow(row);
        // Create a placeholder user for imported players (no phone — use generated unique value)
        const placeholderPhone = `+0000${Date.now()}${Math.floor(Math.random() * 9999)}`;
        const user = await this.prisma.user.create({ data: { phone: placeholderPhone } });
        await this.prisma.player.create({
          data: { ...playerData, userId: user.id },
        });
        results.created++;
      } catch (e) {
        results.failed++;
        results.errors.push(String(e));
      }
    }

    return results;
  }
}
