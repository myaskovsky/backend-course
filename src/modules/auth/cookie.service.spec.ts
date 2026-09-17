import { FastifyReply } from 'fastify';

import { ConfigService } from '@/core/config/config.service';

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';
import { CookieService } from './cookie.service';

describe('CookieService', () => {
  const configValues: Record<string, string> = {
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'lax',
    JWT_ACCESS_TTL: '900',
    JWT_REFRESH_TTL: '2592000',
  };
  const config = {
    get: (k: string) => configValues[k],
  } as unknown as ConfigService;
  const service = new CookieService(config);

  const makeReply = () => {
    const setCookie = jest.fn();
    const clearCookie = jest.fn();
    return {
      reply: { setCookie, clearCookie } as unknown as FastifyReply,
      setCookie,
      clearCookie,
    };
  };

  it('sets HttpOnly/Secure access & refresh cookies with correct scoping', () => {
    const { reply, setCookie } = makeReply();
    service.setAuthCookies(reply, { accessToken: 'a', refreshToken: 'r' });

    const access = setCookie.mock.calls.find(
      (c) => c[0] === ACCESS_TOKEN_COOKIE,
    );
    const refresh = setCookie.mock.calls.find(
      (c) => c[0] === REFRESH_TOKEN_COOKIE,
    );
    expect(access?.[1]).toBe('a');
    expect(access?.[2]).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(refresh?.[2]).toMatchObject({
      path: '/auth/refresh',
      maxAge: 2592000,
    });
  });

  it('clears both auth cookies', () => {
    const { reply, clearCookie } = makeReply();
    service.clearAuthCookies(reply);
    const names = clearCookie.mock.calls.map((c) => c[0]);
    expect(names).toEqual([ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]);
  });
});
