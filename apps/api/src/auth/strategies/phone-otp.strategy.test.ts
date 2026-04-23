import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { PhoneOtpStrategy } from './phone-otp.strategy';
import { TooManyRequestsException } from '../rate-limit.service';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const makePrisma = () => ({
  authOtp: {
    create: vi.fn().mockResolvedValue({ id: 'otp-row-id' }),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  user: {
    upsert: vi.fn(),
  },
});

const makeRateLimit = () => ({
  check: vi.fn().mockResolvedValue(undefined),
  record: vi.fn().mockResolvedValue(undefined),
});

const makeSms = () => ({
  name: 'test-sms',
  send: vi.fn().mockResolvedValue(undefined),
});

describe('PhoneOtpStrategy.initiate', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let rateLimit: ReturnType<typeof makeRateLimit>;
  let sms: ReturnType<typeof makeSms>;
  let strategy: PhoneOtpStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    rateLimit = makeRateLimit();
    sms = makeSms();
    strategy = new PhoneOtpStrategy(
      prisma as any,
      rateLimit as any,
      sms as any,
    );
  });

  // 1
  it('generates 6-digit OTP, stores sha256 hash with 5-min expiry, and calls SMS send', async () => {
    const phone = '+15551234567';
    const before = Date.now();

    await strategy.initiate({ identifier: phone });

    // DB row created
    expect(prisma.authOtp.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.authOtp.create.mock.calls[0][0];
    expect(createArgs.data.phone).toBe(phone);
    expect(createArgs.data.otpHash).toMatch(/^[0-9a-f]{64}$/);
    // expires ~5 min from now (+/- a little jitter)
    const expiresAt = createArgs.data.expiresAt as Date;
    expect(expiresAt).toBeInstanceOf(Date);
    const deltaMs = expiresAt.getTime() - before;
    expect(deltaMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 100);
    expect(deltaMs).toBeLessThanOrEqual(5 * 60 * 1000 + 2000);

    // SMS sent — the sent body contains the 6-digit code; derive it and
    // verify the stored hash matches.
    expect(sms.send).toHaveBeenCalledTimes(1);
    const [to, body] = sms.send.mock.calls[0];
    expect(to).toBe(phone);
    const codeMatch = /(\d{6})/.exec(body as string);
    expect(codeMatch).not.toBeNull();
    const code = codeMatch![1];
    expect(sha256(code)).toBe(createArgs.data.otpHash);

    // Rate-limit: check before work; record success after.
    expect(rateLimit.check).toHaveBeenCalledWith(phone);
    expect(rateLimit.record).toHaveBeenCalledWith(phone, true);
  });

  // 2
  it('propagates TooManyRequestsException from rateLimit.check', async () => {
    rateLimit.check.mockRejectedValueOnce(
      new TooManyRequestsException('Too many failed attempts, try again later'),
    );

    await expect(
      strategy.initiate({ identifier: '+15550000001' }),
    ).rejects.toThrow(TooManyRequestsException);

    // No OTP row created, no SMS sent, no attempt recorded when over-limit.
    expect(prisma.authOtp.create).not.toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
    expect(rateLimit.record).not.toHaveBeenCalled();
  });

  // 3
  it('still persists OTP row if SMS provider throws (fire-and-forget)', async () => {
    sms.send.mockRejectedValueOnce(new Error('SMS provider exploded'));

    await expect(
      strategy.initiate({ identifier: '+15550000002' }),
    ).resolves.toBeUndefined();

    expect(prisma.authOtp.create).toHaveBeenCalledTimes(1);
    // Success is recorded even though SMS delivery failed — the DB row is
    // the source of truth for "the send happened".
    expect(rateLimit.record).toHaveBeenCalledWith('+15550000002', true);
  });
});

describe('PhoneOtpStrategy.complete', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let rateLimit: ReturnType<typeof makeRateLimit>;
  let sms: ReturnType<typeof makeSms>;
  let strategy: PhoneOtpStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    rateLimit = makeRateLimit();
    sms = makeSms();
    strategy = new PhoneOtpStrategy(
      prisma as any,
      rateLimit as any,
      sms as any,
    );
  });

  // 4
  it('returns {userId, role} on valid unused OTP and marks it used', async () => {
    const phone = '+15559990001';
    const code = '123456';
    prisma.authOtp.findFirst.mockResolvedValue({
      id: 'otp-1',
      phone,
      otpHash: sha256(code),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });
    prisma.user.upsert.mockResolvedValue({ id: 'user-1', role: 'player' });

    const result = await strategy.complete({
      identifier: phone,
      credential: code,
    });

    expect(result).toEqual({ userId: 'user-1', role: 'player' });
    expect(prisma.authOtp.update).toHaveBeenCalledTimes(1);
    const updateArgs = prisma.authOtp.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'otp-1' });
    expect(updateArgs.data.usedAt).toBeInstanceOf(Date);
  });

  // 5
  it('creates a new user when phone is unseen (upsert)', async () => {
    const phone = '+15559990002';
    const code = '654321';
    prisma.authOtp.findFirst.mockResolvedValue({
      id: 'otp-2',
      phone,
      otpHash: sha256(code),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });
    prisma.user.upsert.mockResolvedValue({ id: 'new-user', role: 'player' });

    const result = await strategy.complete({
      identifier: phone,
      credential: code,
    });

    expect(result).toEqual({ userId: 'new-user', role: 'player' });
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = prisma.user.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ phone });
    expect(upsertArgs.update).toEqual({});
    expect(upsertArgs.create).toEqual({ phone, role: 'player' });
    expect(rateLimit.record).toHaveBeenCalledWith(phone, true);
  });

  // 6
  it('throws "Invalid or expired code" when no unused/unexpired OTP exists', async () => {
    const phone = '+15559990003';
    prisma.authOtp.findFirst.mockResolvedValue(null);

    await expect(
      strategy.complete({ identifier: phone, credential: '000000' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid or expired code'));

    expect(rateLimit.record).toHaveBeenCalledWith(phone, false);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  // 7
  it('throws "Invalid or expired code" when code hash does not match', async () => {
    const phone = '+15559990004';
    prisma.authOtp.findFirst.mockResolvedValue({
      id: 'otp-4',
      phone,
      otpHash: sha256('111111'),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });

    await expect(
      strategy.complete({ identifier: phone, credential: '222222' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid or expired code'));

    expect(prisma.authOtp.update).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  // 8
  it('records rate-limit failure on wrong code', async () => {
    const phone = '+15559990005';
    prisma.authOtp.findFirst.mockResolvedValue({
      id: 'otp-5',
      phone,
      otpHash: sha256('111111'),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });

    await expect(
      strategy.complete({ identifier: phone, credential: '999999' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(rateLimit.record).toHaveBeenCalledTimes(1);
    expect(rateLimit.record).toHaveBeenCalledWith(phone, false);
  });
});
