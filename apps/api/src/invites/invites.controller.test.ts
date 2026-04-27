import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { InvitesController } from './invites.controller';

describe('InvitesController', () => {
  function makeReq(role: string, userId = 'admin-1') {
    return { user: { userId, role } } as never;
  }

  it('creates an invite and returns the public payload', async () => {
    const created = {
      id: 'i1',
      code: 'CODE123',
      role: 'organizer',
      expiresAt: new Date('2026-05-01T00:00:00Z'),
      usedAt: null,
      usedBy: null,
      createdBy: 'admin-1',
      createdAt: new Date('2026-04-26T00:00:00Z'),
    };
    const svc = { create: vi.fn().mockResolvedValue(created) } as never;
    const ctrl = new InvitesController(svc);

    const out = await ctrl.create(
      { role: 'organizer', expiresAt: '2026-05-01T00:00:00Z' },
      makeReq('admin'),
    );

    expect((svc as any).create).toHaveBeenCalledWith({
      role: 'organizer',
      expiresAt: new Date('2026-05-01T00:00:00Z'),
      createdBy: 'admin-1',
    });
    expect(out).toEqual({
      id: 'i1',
      code: 'CODE123',
      role: 'organizer',
      expiresAt: '2026-05-01T00:00:00.000Z',
    });
  });

  it('rejects malformed expiresAt', async () => {
    const svc = { create: vi.fn() } as never;
    const ctrl = new InvitesController(svc);
    await expect(
      ctrl.create({ role: 'player', expiresAt: 'not-a-date' }, makeReq('admin')),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown role', async () => {
    const svc = { create: vi.fn() } as never;
    const ctrl = new InvitesController(svc);
    await expect(
      ctrl.create(
        { role: 'superuser' as never, expiresAt: '2026-05-01T00:00:00Z' },
        makeReq('admin'),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
