import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../common/prisma.service';
import {
  SMS_PROVIDER,
  SmsProvider,
} from '../../notifications/sms-provider.interface';
import { RateLimitService } from '../rate-limit.service';
import {
  AuthCompleteInput,
  AuthInitiateInput,
  AuthStrategy,
  AuthenticatedUser,
} from './auth-strategy.interface';

/** OTP validity window. */
const OTP_TTL_MINUTES = 5;
/** Number of digits in the generated OTP. */
const OTP_LENGTH = 6;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Generates a zero-padded numeric OTP using crypto.randomInt for uniform
 * distribution over [0, 10^OTP_LENGTH). Padded so codes like "000042" are
 * possible and have equal probability.
 */
function generateOtp(): string {
  const upper = 10 ** OTP_LENGTH;
  return randomInt(0, upper).toString().padStart(OTP_LENGTH, '0');
}

/**
 * Phone-number OTP auth strategy. Two-step (initiate → complete):
 *   - `initiate` generates a short-lived code, stores its sha256 hash in
 *     AuthOtp, and dispatches an SMS to the identifier.
 *   - `complete` verifies the supplied code against the most recent
 *     unused/unexpired row, upserts the user, and returns identity.
 *
 * OTPs are hashed (sha256, not bcrypt) because they're short-lived, high-
 * entropy (6 digits / ~1M space, but 5-min TTL and rate-limited), and
 * single-use. bcrypt would add latency without meaningfully raising the
 * attacker's cost at this TTL.
 */
@Injectable()
export class PhoneOtpStrategy implements AuthStrategy {
  readonly name = 'phone-otp';
  private readonly logger = new Logger(PhoneOtpStrategy.name);

  constructor(
    private prisma: PrismaService,
    private rateLimit: RateLimitService,
    @Inject(SMS_PROVIDER) private sms: SmsProvider,
  ) {}

  async initiate(input: AuthInitiateInput): Promise<void> {
    const { identifier } = input;

    // Rate-limit OTP sends too — otherwise an attacker can spam the SMS
    // provider and/or burn the victim's ability to receive legitimate codes.
    await this.rateLimit.check(identifier);

    const otp = generateOtp();
    const otpHash = sha256Hex(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.authOtp.create({
      data: { phone: identifier, otpHash, expiresAt },
    });

    // Fire-and-forget SMS: if delivery fails, the row still exists. We
    // treat the DB insert as "the send happened" — the user can request
    // a new code if needed. Do NOT propagate SMS errors; log instead.
    try {
      await this.sms.send(identifier, `Your TTRGE code: ${otp}`);
    } catch (err) {
      this.logger.warn(
        `SMS send failed for ${identifier}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await this.rateLimit.record(identifier, true);
  }

  async complete(input: AuthCompleteInput): Promise<AuthenticatedUser> {
    const { identifier, credential } = input;

    await this.rateLimit.check(identifier);

    const otp = await this.prisma.authOtp.findFirst({
      where: {
        phone: identifier,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (otp == null) {
      await this.rateLimit.record(identifier, false);
      throw new UnauthorizedException('Invalid or expired code');
    }

    const providedHash = sha256Hex(credential);
    if (providedHash !== otp.otpHash) {
      await this.rateLimit.record(identifier, false);
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.prisma.authOtp.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });

    const user = await this.prisma.user.upsert({
      where: { phone: identifier },
      update: {},
      create: { phone: identifier, role: 'player' },
    });

    await this.rateLimit.record(identifier, true);

    return { userId: user.id, role: user.role };
  }
}
