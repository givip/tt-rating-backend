import { z } from 'zod';

export const CreatePlayerSchema = z.object({
  firstNameKa: z.string().min(1),
  lastNameKa: z.string().min(1),
  firstNameEn: z.string().min(1),
  lastNameEn: z.string().min(1),
  birthDate: z.string().date().optional(),
  gender: z.enum(['M', 'F']),
  city: z.string().optional(),
  selfRating: z.enum(['beginner', 'amateur', 'experienced', 'ranked']).optional(),
});

export const PlayerListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  city: z.string().optional(),
  gender: z.enum(['M', 'F']).optional(),
  search: z.string().optional(),
});

export type CreatePlayerDto = z.infer<typeof CreatePlayerSchema>;
export type PlayerListQuery = z.infer<typeof PlayerListQuerySchema>;
