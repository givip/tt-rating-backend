import { describe, it, expect, vi } from 'vitest';
import { InvitesService } from './invites.service';

describe('InvitesService.create', () => {
  it('generates a code, stores it with role and expiry', async () => {
    const create = vi.fn().mockImplementation(async ({ data }) => ({
      id: 'i1',
      ...data,
      createdAt: new Date('2026-04-26T00:00:00Z'),
      usedAt: null,
      usedBy: null,
    }));
    const prisma = { invite: { create } } as never;

    const svc = new InvitesService(prisma);
    const out = await svc.create({
      role: 'organizer' as never,
      expiresAt: new Date('2026-05-03T00:00:00Z'),
      createdBy: 'admin-1',
    });

    expect(create).toHaveBeenCalled();
    const arg = create.mock.calls[0][0];
    expect(arg.data.role).toBe('organizer');
    expect(arg.data.createdBy).toBe('admin-1');
    expect(typeof arg.data.code).toBe('string');
    expect(arg.data.code.length).toBeGreaterThanOrEqual(16);
    expect((out as any).code).toBe(arg.data.code);
  });

  it('rejects expiry in the past', async () => {
    const prisma = { invite: { create: vi.fn() } } as never;
    const svc = new InvitesService(prisma);
    await expect(
      svc.create({
        role: 'player' as never,
        expiresAt: new Date(Date.now() - 1000),
        createdBy: 'admin-1',
      }),
    ).rejects.toThrow(/past/i);
  });
});
