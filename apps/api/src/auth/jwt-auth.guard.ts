import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from './token.service';

/**
 * Verifies the `Authorization: Bearer <jwt>` header via `TokenService` and
 * attaches the decoded `{ userId, role }` to `req.user`. Throws
 * `UnauthorizedException` on a missing/malformed header or an invalid token.
 *
 * This is the replacement for the inline bearer-extraction in
 * `AuthController.logout` — downstream controllers can now
 * `@UseGuards(JwtAuthGuard)` and read `req.user` directly.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown>; user?: unknown }>();

    const header = req.headers?.['authorization'];
    const raw = typeof header === 'string' ? header : '';
    const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
    if (!match) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    req.user = this.tokens.verifyAccess(match[1].trim());
    return true;
  }
}

/** Typed shape of `req.user` after `JwtAuthGuard` runs. */
export interface AuthenticatedRequestUser {
  userId: string;
  role: string;
}
