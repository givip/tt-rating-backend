import { SetMetadata } from '@nestjs/common';

/** Metadata key read by `RolesGuard`. */
export const ROLES_KEY = 'tt_rating:roles';

/**
 * Restrict a route (or entire controller) to the given `UserRole` values.
 * Evaluated after `JwtAuthGuard` populates `req.user`. Example:
 *
 * ```ts
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Roles('admin')
 * @Get('queue')
 * getQueue() { ... }
 * ```
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
