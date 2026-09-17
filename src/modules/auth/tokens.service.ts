import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ConfigService } from '@/core/config/config.service';

import { JwtPayload } from './auth.constants';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenSubject {
  userId: string;
  email: string;
  roles?: string[];
}

/**
 * Signs and verifies the access/refresh JWT pair. Secrets and TTLs are read
 * per-call from config so the two token types use independent keys.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async issueTokenPair(subject: TokenSubject): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          sub: subject.userId,
          email: subject.email,
          type: 'access',
          roles: subject.roles ?? [],
        },
        { secret: this.accessSecret(), expiresIn: this.accessTtl() },
      ),
      this.jwtService.signAsync(
        { sub: subject.userId, email: subject.email, type: 'refresh' },
        { secret: this.refreshSecret(), expiresIn: this.refreshTtl() },
      ),
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

  private accessSecret(): string {
    return this.configService.get('JWT_ACCESS_SECRET');
  }

  private refreshSecret(): string {
    return this.configService.get('JWT_REFRESH_SECRET');
  }
}
