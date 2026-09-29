import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ConfigService } from '@/core/config/config.service';

import { JwtPayload, TokenType } from './auth.constants';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenSubject {
  userId: string;
  email: string;
}

/**
 * Signs and verifies the access/refresh JWT pair. Secrets and TTLs are read
 * per-call from config so the two token types use independent keys. Every
 * token carries a unique `jti` so it can be revoked individually.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async issueTokenPair(subject: TokenSubject): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.sign(subject, 'access', this.accessSecret(), this.accessTtl()),
      this.sign(subject, 'refresh', this.refreshSecret(), this.refreshTtl()),
    ]);

    return { accessToken, refreshToken };
  }

  verifyAccess(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      secret: this.accessSecret(),
    });
  }

  verifyRefresh(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      secret: this.refreshSecret(),
    });
  }

  accessTtl(): number {
    return Number(this.configService.get('JWT_ACCESS_TTL'));
  }

  refreshTtl(): number {
    return Number(this.configService.get('JWT_REFRESH_TTL'));
  }

  private sign(
    subject: TokenSubject,
    type: TokenType,
    secret: string,
    expiresIn: number,
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: subject.userId,
        email: subject.email,
        type,
        // Millisecond-precision iat (RFC 7519 NumericDate may be fractional):
        // lets a token issued right after `users.tokensValidAfter` be told
        // apart from one issued in the same second before it.
        iat: Date.now() / 1000,
      },
      { secret, expiresIn, jwtid: randomUUID() },
    );
  }

  private accessSecret(): string {
    return this.configService.get('JWT_ACCESS_SECRET');
  }

  private refreshSecret(): string {
    return this.configService.get('JWT_REFRESH_SECRET');
  }
}
