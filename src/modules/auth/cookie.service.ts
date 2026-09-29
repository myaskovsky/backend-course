import { Injectable } from '@nestjs/common';
import { FastifyReply } from 'fastify';

import { ConfigService } from '@/core/config/config.service';

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';
import { TokenPair } from './tokens.service';

/**
 * The refresh cookie is sent to /auth/refresh and /auth/logout only (so logout
 * can revoke it). It used to be scoped to /auth/refresh; that path is cleared
 * too so a stale cookie there cannot shadow the current one.
 */
const REFRESH_COOKIE_PATH = '/auth';
const LEGACY_REFRESH_COOKIE_PATH = '/auth/refresh';

/**
 * Centralizes auth-cookie handling (HttpOnly/Secure/SameSite) so controllers
 * stay thin and cookie policy lives in one place.
 */
@Injectable()
export class CookieService {
  constructor(private readonly configService: ConfigService) {}

  setAuthCookies(reply: FastifyReply, tokens: TokenPair): void {
    reply.setCookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...this.baseOptions(),
      maxAge: Number(this.configService.get('JWT_ACCESS_TTL')),
    });
    reply.setCookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...this.baseOptions(),
      path: REFRESH_COOKIE_PATH,
      maxAge: Number(this.configService.get('JWT_REFRESH_TTL')),
    });
    this.clearLegacyRefreshCookie(reply);
  }

  clearAuthCookies(reply: FastifyReply): void {
    reply.clearCookie(ACCESS_TOKEN_COOKIE, { ...this.baseOptions() });
    reply.clearCookie(REFRESH_TOKEN_COOKIE, {
      ...this.baseOptions(),
      path: REFRESH_COOKIE_PATH,
    });
    this.clearLegacyRefreshCookie(reply);
  }

  private clearLegacyRefreshCookie(reply: FastifyReply): void {
    reply.clearCookie(REFRESH_TOKEN_COOKIE, {
      ...this.baseOptions(),
      path: LEGACY_REFRESH_COOKIE_PATH,
    });
  }

  private baseOptions() {
    const domain = this.configService.get('COOKIE_DOMAIN');
    return {
      httpOnly: true,
      secure: String(this.configService.get('COOKIE_SECURE')) === 'true',
      sameSite: this.configService.get('COOKIE_SAMESITE') as
        | 'lax'
        | 'strict'
        | 'none',
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }
}
