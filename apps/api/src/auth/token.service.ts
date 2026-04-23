import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@tt-rating/db/generated';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';

/** Minimal config interface — compatible with @nestjs/config's ConfigService. */
export interface TokenConfigService {
  get<T = string>(key: string): T | undefined;
}

/**
 * DI token for `TokenConfigService`. Using a Symbol (rather than the type) means
 * tests and module factories can bind a concrete implementation without pulling
 * in @nestjs/config. The AuthModule wires a thin shim over `process.env`.
 */
export const TOKEN_CONFIG_SERVICE = Symbol('TokenConfigService');

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access token TTL in seconds. */
  expiresIn: number;
}

/**
 * Parses a duration string like '15m', '2h', '30d', '45s', or a bare number of seconds.
 * Returns the duration in **seconds**.
 */
export function parseTtlSeconds(input: string): number {
  const trimmed = input.trim();
  const match = /^(\d+)([smhd])?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid TTL: ${input}`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2] ?? 's';
  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86_400;
    default:
      throw new Error(`Invalid TTL unit: ${unit}`);
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class TokenService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    @Inject(TOKEN_CONFIG_SERVICE) private config: TokenConfigService,
  ) {}

  private accessTtlSeconds(): number {
    return parseTtlSeconds(this.config.get<string>('AUTH_ACCESS_TTL') ?? '15m');
  }

  private refreshTtlSeconds(): number {
    return parseTtlSeconds(this.config.get<string>('AUTH_REFRESH_TTL') ?? '30d');
  }

  async issue(userId: string, role: string): Promise<TokenPair> {
    const accessTtl = this.accessTtlSeconds();
    const refreshTtl = this.refreshTtlSeconds();

    const refreshToken = generateRefreshToken();
    const tokenHash = sha256Hex(refreshToken);
    const expiresAt = new Date(Date.now() + refreshTtl * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    const accessToken = this.jwt.sign(
      { sub: userId, role },
      { expiresIn: accessTtl },
    );

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  async rotate(refreshToken: string): Promise<TokenPair> {
    const tokenHash = sha256Hex(refreshToken);
    const accessTtl = this.accessTtlSeconds();
    const refreshTtl = this.refreshTtlSeconds();

    // Rotation is split in two phases so we can revoke the whole chain on
    // reuse WITHOUT being rolled back. Prisma rolls back the transaction on
    // any thrown error, which would undo chain revocation — so the txn only
    // returns a discriminated result and all throws happen after it commits.
    type Result =
      | { kind: 'invalid' }
      | { kind: 'expired' }
      | { kind: 'reuse'; userId: string }
      | { kind: 'ok'; userId: string; role: string; newPlain: string };

    const result: Result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<Result> => {
        const existing = await tx.refreshToken.findUnique({
          where: { tokenHash },
          include: { user: { select: { role: true } } },
        });

        if (!existing) return { kind: 'invalid' };

        if (existing.expiresAt.getTime() < Date.now()) {
          return { kind: 'expired' };
        }

        if (existing.revokedAt != null) {
          // Token presented was already revoked — reuse. Chain revocation
          // happens after the txn commits (see below).
          return { kind: 'reuse', userId: existing.userId };
        }

        // Atomically claim the row. If two concurrent rotations both read a
        // non-revoked `existing`, only one of their updateMany calls will
        // actually flip `revokedAt`; the other sees count === 0 and is
        // treated as reuse.
        const claim = await tx.refreshToken.updateMany({
          where: { id: existing.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (claim.count === 0) {
          return { kind: 'reuse', userId: existing.userId };
        }

        if (existing.user == null) {
          // User was deleted between issue and rotation. `existing.revokedAt`
          // is now set by the claim above — that's fine, it's a dangling
          // orphan row and we don't want to reissue for a missing user.
          return { kind: 'invalid' };
        }

        const candidatePlain = generateRefreshToken();
        const candidateHash = sha256Hex(candidatePlain);
        const newExpiresAt = new Date(Date.now() + refreshTtl * 1000);

        const created = await tx.refreshToken.create({
          data: {
            userId: existing.userId,
            tokenHash: candidateHash,
            expiresAt: newExpiresAt,
          },
        });

        await tx.refreshToken.update({
          where: { id: existing.id },
          data: { replacedBy: created.id },
        });

        return {
          kind: 'ok',
          userId: existing.userId,
          role: existing.user.role,
          newPlain: candidatePlain,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.kind === 'invalid') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (result.kind === 'expired') {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (result.kind === 'reuse') {
      // Chain-wide revocation runs OUTSIDE the txn above so the writes can't
      // be rolled back by the throw below. Invalidates both the attacker's
      // chain and the victim's — the only safe response to token reuse.
      await this.prisma.refreshToken.updateMany({
        where: { userId: result.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // JWT signing is deterministic and cheap; doing it outside the txn keeps
    // the DB transaction short. If signing failed we'd still have committed a
    // fresh refresh row, but @nestjs/jwt's sync `sign` only fails on config
    // errors, which would mean the service is broken globally.
    const accessToken = this.jwt.sign(
      { sub: result.userId, role: result.role },
      { expiresIn: accessTtl },
    );

    return { accessToken, refreshToken: result.newPlain, expiresIn: accessTtl };
  }

  verifyAccess(accessToken: string): { userId: string; role: string } {
    try {
      const payload = this.jwt.verify(accessToken) as { sub: string; role: string };
      return { userId: payload.sub, role: payload.role };
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
