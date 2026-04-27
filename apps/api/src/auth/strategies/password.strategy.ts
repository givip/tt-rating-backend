import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma.service';
import { RateLimitService } from '../rate-limit.service';
import { TOKEN_CONFIG_SERVICE, TokenConfigService } from '../token.service';
import {
  AuthCompleteInput,
  AuthStrategy,
  AuthenticatedUser,
} from './auth-strategy.interface';

/** Minimum bcrypt cost accepted. Reads below this floor are clamped up. */
export const MIN_BCRYPT_COST = 12;
/** Default bcrypt cost when none is configured. */
export const DEFAULT_BCRYPT_COST = 12;

/**
 * Pre-computed bcrypt hash used when the caller-supplied identifier doesn't
 * match a user (or matches a user with no passwordHash). Running
 * `bcrypt.compare(credential, DUMMY_HASH)` burns roughly the same CPU as a
 * real compare, so the failure path is indistinguishable by timing from a
 * real wrong-password attempt.
 *
 * Generated once via `bcrypt.hashSync('_tt-rating-dummy_', 12)`. The value is
 * not secret — stability matters so behavior is reproducible across hosts.
 */
export const DUMMY_HASH =
  '$2b$12$5etNUEjY6hlg75HJ8NjJF.E.vwAH9WBHnu5MyYYMOxX6W6Fv4urZq';

/**
 * Hash a plaintext password with a min-12 cost floor. Exported for use by
 * seed/admin tooling (e.g. creating an initial admin user).
 */
export async function hashPassword(
  plain: string,
  cost: number = DEFAULT_BCRYPT_COST,
): Promise<string> {
  const c = Math.max(cost, MIN_BCRYPT_COST);
  return bcrypt.hash(plain, c);
}

const ALLOWED_FIELDS = ['email', 'phone'] as const;
type LookupField = (typeof ALLOWED_FIELDS)[number];

function parseLookupFields(raw: string | undefined): LookupField[] {
  const fields = (raw ?? 'email,phone')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const f of fields) {
    if (!ALLOWED_FIELDS.includes(f as LookupField)) {
      throw new Error(`Unknown lookup field: ${f}`);
    }
  }
  return fields as LookupField[];
}

@Injectable()
export class PasswordStrategy implements AuthStrategy {
  readonly name = 'password';

  constructor(
    private prisma: PrismaService,
    private rateLimit: RateLimitService,
    // TokenConfigService is the structural interface already used by
    // TokenService — reused here to read AUTH_BCRYPT_COST when needed.
    @Inject(TOKEN_CONFIG_SERVICE) private config: TokenConfigService,
  ) {}

  // `initiate` intentionally omitted — password is one-shot.

  async complete(input: AuthCompleteInput): Promise<AuthenticatedUser> {
    const { identifier, credential, meta } = input;
    const ip =
      meta && typeof meta.ip === 'string' ? (meta.ip as string) : undefined;

    // 1. Enforce rate limit BEFORE any DB or bcrypt work. Let the 429 propagate.
    await this.rateLimit.check(identifier);

    // 2. Look up by configured fields. Default is email+phone (preserved
    //    historic behavior); deployments can lock down via env var.
    const lookupFields = parseLookupFields(
      this.config.get<string>('AUTH_PASSWORD_LOOKUP_FIELDS'),
    );
    const user = await this.prisma.user.findFirst({
      where: {
        OR: lookupFields.map((field) => ({ [field]: identifier })),
      },
    });

    // 3. Timing-safe miss path: user not found OR user has no passwordHash
    //    (e.g. OAuth-only account). Burn the same CPU as a real compare so
    //    attackers can't distinguish "user doesn't exist" from "wrong
    //    password" via response time.
    if (user == null || user.passwordHash == null) {
      await bcrypt.compare(credential, DUMMY_HASH);
      await this.rateLimit.record(identifier, false, ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 4. Real compare.
    const ok = await bcrypt.compare(credential, user.passwordHash);
    if (!ok) {
      await this.rateLimit.record(identifier, false, ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 5. Success.
    await this.rateLimit.record(identifier, true, ip);
    return { userId: user.id, role: user.role };
  }
}
