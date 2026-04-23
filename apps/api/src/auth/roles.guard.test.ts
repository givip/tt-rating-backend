import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

function makeCtx(user: unknown, handler = () => undefined, classRef: any = class Ctrl {}): ExecutionContext {
  const req = { user } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => classRef,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows access when no @Roles() metadata is present', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeCtx({ userId: 'u', role: 'player' }))).toBe(true);
  });

  it('allows when user.role matches one of the required roles', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin', 'organizer']);
    expect(guard.canActivate(makeCtx({ userId: 'u', role: 'organizer' }))).toBe(true);
  });

  it('throws ForbiddenException when user.role is not in the list', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(() => guard.canActivate(makeCtx({ userId: 'u', role: 'player' }))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when req.user is missing (guard ordering error)', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(() => guard.canActivate(makeCtx(undefined))).toThrow(ForbiddenException);
  });

  it('method-level @Roles() overrides class-level when both are present', () => {
    // Reflector.getAllAndOverride picks method over class — that's the contract.
    // Here we just assert the guard uses getAllAndOverride (not getAll).
    const spy = vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    guard.canActivate(makeCtx({ userId: 'u', role: 'admin' }));
    expect(spy).toHaveBeenCalledWith(ROLES_KEY, [expect.any(Function), expect.any(Function)]);
  });
});

describe('@Roles decorator', () => {
  it('sets ROLES_KEY metadata with the given roles', () => {
    class Ctrl {
      @Roles('admin', 'organizer')
      doThing() {}
    }
    const meta = Reflect.getMetadata(ROLES_KEY, Ctrl.prototype.doThing);
    expect(meta).toEqual(['admin', 'organizer']);
  });
});
