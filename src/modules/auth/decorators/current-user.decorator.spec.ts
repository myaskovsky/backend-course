import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import type { RequestUser } from '../auth.constants';
import { CurrentUser } from './current-user.decorator';

type Factory = (data: unknown, ctx: ExecutionContext) => RequestUser;

/** Applies the param decorator to a dummy handler and pulls out its factory. */
function getParamDecoratorFactory(): Factory {
  class TestController {
    handler(@CurrentUser() user: RequestUser): RequestUser {
      return user;
    }
  }
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestController,
    'handler',
  ) as Record<string, { factory: Factory }>;
  return args[Object.keys(args)[0]].factory;
}

function contextWithRequest(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CurrentUser decorator', () => {
  const factory = getParamDecoratorFactory();

  it('returns the principal attached to the request by JwtStrategy', () => {
    const user: RequestUser = {
      userId: 'u1',
      email: 'u1@example.com',
      roles: ['user'],
    };
    expect(factory(undefined, contextWithRequest({ user }))).toBe(user);
  });

  it('returns undefined when no principal is attached', () => {
    expect(factory(undefined, contextWithRequest({}))).toBeUndefined();
  });

  it('ignores decorator data', () => {
    const user: RequestUser = { userId: 'u2', email: 'e', roles: [] };
    expect(factory('email', contextWithRequest({ user }))).toBe(user);
  });
});
