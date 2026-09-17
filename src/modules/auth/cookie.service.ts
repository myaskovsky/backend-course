import { Injectable } from '@nestjs/common';
import { FastifyReply } from 'fastify';

import { ConfigService } from '@/core/config/config.service';

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';
import { TokenPair } from './tokens.service';

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
      // scope the refresh cookie to the refresh endpoint only
      path: '/auth/refresh',
      maxAge: Number(this.configService.get('JWT_REFRESH_TTL')),
    });
  }

  clearAuthCookies(reply: FastifyReply): void {
    reply.clearCookie(ACCESS_TOKEN_COOKIE, { ...this.baseOptions() });
    reply.clearCookie(REFRESH_TOKEN_COOKIE, {
      ...this.baseOptions(),
      path: '/auth/refresh',
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
