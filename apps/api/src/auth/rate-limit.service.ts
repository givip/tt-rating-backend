// NOTE: LoginAttempt has no retention policy. Purge older rows via a scheduled
// job (future ops task). Table grows ~N rows per login attempt per identifier.
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@tt-rating/db/generated';
import { PrismaService } from '../common/prisma.service';

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 5;

/**
 * HTTP 429. `@nestjs/common` (v10) doesn't ship a built-in TooManyRequests
 * exception class, so we define one locally with the conventional name.
 */
export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too Many Requests') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Throws TooManyRequestsException (HTTP 429) when `identifier` has more than
   * MAX_FAILURES failed attempts in the last WINDOW_MINUTES.
   */
  async check(identifier: string): Promise<void> {
    const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
    const where: Prisma.LoginAttemptWhereInput = {
      identifier,
      success: false,
      createdAt: { gt: cutoff },
    };

    const failures = await this.prisma.loginAttempt.count({ where });

    if (failures > MAX_FAILURES) {
      throw new TooManyRequestsException(
        'Too many failed attempts, try again later',
      );
    }
  }

  /** Append an attempt row. Never throws — logs and swallows DB errors. */
  async record(identifier: string, success: boolean, ip?: string): Promise<void> {
    try {
      await this.prisma.loginAttempt.create({
        data: {
          identifier,
          ip: ip ?? null,
          success,
        },
      });
    } catch (err) {
      // Rate-limit bookkeeping must never block the auth flow.
      this.logger.warn(
        `Failed to record login attempt for ${identifier}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
