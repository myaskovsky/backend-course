import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RbacService } from '../rbac.service';
import { RbacGuard } from './rbac.guard';

describe('RbacGuard', () => {
  let guard: RbacGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let rbac: jest.Mocked<Pick<RbacService, 'check'>>;

  const ctxWith = (user: unknown): ExecutionContext =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    rbac = { check: jest.fn() };
    guard = new RbacGuard(
      reflector as unknown as Reflector,
      rbac as unknown as RbacService,
    );
  });

  it('allows routes without a required permission', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(ctxWith({ roles: [] }))).toBe(true);
  });

  it('401 when no user is present', () => {
    reflector.getAllAndOverride.mockReturnValue({
      resource: 'users',
      action: 'read',
    });
    expect(() => guard.canActivate(ctxWith(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('403 when the permission check fails', () => {
    reflector.getAllAndOverride.mockReturnValue({
      resource: 'users',
      action: 'read',
    });
    rbac.check.mockReturnValue(false);
    expect(() => guard.canActivate(ctxWith({ roles: ['user'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('allows when the permission check passes', () => {
    reflector.getAllAndOverride.mockReturnValue({
      resource: 'users',
      action: 'read',
    });
    rbac.check.mockReturnValue(true);
    expect(guard.canActivate(ctxWith({ roles: ['admin'] }))).toBe(true);
    expect(rbac.check).toHaveBeenCalledWith(['admin'], 'users', 'read');
  });
});
