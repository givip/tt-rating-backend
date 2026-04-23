import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitService, TooManyRequestsException } from './rate-limit.service';

type PrismaLoginAttemptStub = {
  loginAttempt: {
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

const makePrisma = (): PrismaLoginAttemptStub => ({
  loginAttempt: {
    count: vi.fn(),
    create: vi.fn(),
  },
});

describe('RateLimitService', () => {
  let prisma: PrismaLoginAttemptStub;
  let service: RateLimitService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    service = new RateLimitService(prisma as any);
  });

  it('check() passes when identifier has 0 failures in window', async () => {
    prisma.loginAttempt.count.mockResolvedValue(0);

    await expect(service.check('user@example.com')).resolves.toBeUndefined();
  });

  it('check() passes when identifier has exactly 5 failures in window (boundary)', async () => {
    prisma.loginAttempt.count.mockResolvedValue(5);

    await expect(service.check('user@example.com')).resolves.toBeUndefined();
  });

  it('check() throws TooManyRequestsException when identifier has 6 failures in window', async () => {
    prisma.loginAttempt.count.mockResolvedValue(6);

    await expect(service.check('user@example.com')).rejects.toThrow(
      TooManyRequestsException,
    );
    await expect(service.check('user@example.com')).rejects.toThrow(
      'Too many failed attempts, try again later',
    );
  });

  it('check() queries only failures within the 15-minute window', async () => {
    prisma.loginAttempt.count.mockResolvedValue(0);

    const before = Date.now();
    await service.check('user@example.com');
    const after = Date.now();

    expect(prisma.loginAttempt.count).toHaveBeenCalledTimes(1);
    const args = prisma.loginAttempt.count.mock.calls[0][0];
    expect(args.where.identifier).toBe('user@example.com');
    expect(args.where.success).toBe(false);
    expect(args.where.createdAt.gt).toBeInstanceOf(Date);

    const cutoffMs = (args.where.createdAt.gt as Date).getTime();
    const windowMs = 15 * 60 * 1000;
    // cutoff = now - 15 min, where "now" is sampled inside check().
    // Expect cutoff to sit in [before - window - 1000, after - window + 1000].
    expect(cutoffMs).toBeGreaterThanOrEqual(before - windowMs - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - windowMs + 1000);
  });

  it('record() writes an attempt row with identifier, success, ip', async () => {
    prisma.loginAttempt.create.mockResolvedValue({ id: 'x' });

    await service.record('user@example.com', false, '10.0.0.1');

    expect(prisma.loginAttempt.create).toHaveBeenCalledTimes(1);
    const args = prisma.loginAttempt.create.mock.calls[0][0];
    expect(args.data).toEqual({
      identifier: 'user@example.com',
      ip: '10.0.0.1',
      success: false,
    });
  });

  it('record() writes null ip when none provided', async () => {
    prisma.loginAttempt.create.mockResolvedValue({ id: 'x' });

    await service.record('user@example.com', true);

    expect(prisma.loginAttempt.create).toHaveBeenCalledTimes(1);
    const args = prisma.loginAttempt.create.mock.calls[0][0];
    expect(args.data).toEqual({
      identifier: 'user@example.com',
      ip: null,
      success: true,
    });
  });

  it('record() does NOT throw when the DB insert fails', async () => {
    prisma.loginAttempt.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.record('user@example.com', false, '10.0.0.1'),
    ).resolves.toBeUndefined();
  });
});
