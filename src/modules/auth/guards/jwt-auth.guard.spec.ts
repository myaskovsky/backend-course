import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let guard: JwtAuthGuard;

  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);
  });

  it('bypasses authentication for @Public() routes', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('delegates to passport for protected routes', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const superCanActivate = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue('delegated');

    const result = guard.canActivate(ctx);
    expect(result).toBe('delegated');
    superCanActivate.mockRestore();
  });
});
