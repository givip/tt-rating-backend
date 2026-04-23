import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/**
 * Checks `req.user.role` against the roles declared via `@Roles(...)` on the
 * method or class. Must be combined with `JwtAuthGuard` — this guard trusts
 * `req.user` to already be populated.
 *
 * Routes without `@Roles()` metadata are allowed through unchanged, so
 * unrestricted endpoints keep working after the guard is registered globally.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: { role?: string } }>().user;
    if (!user || typeof user.role !== 'string') {
      // No authenticated user attached. This usually means JwtAuthGuard
      // didn't run or didn't set req.user — treat as forbidden so we fail
      // closed rather than letting the request through.
      throw new ForbiddenException('Insufficient role');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
