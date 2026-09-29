import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ConfigService } from '@/core/config/config.service';
import { UserStatus } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import {
  ACCESS_TOKEN_COOKIE,
  JwtPayload,
  RequestUser,
} from '../auth.constants';
import { TokenRevocationService } from '../token-revocation.service';

const cookieExtractor = (req: FastifyRequest): string | null => {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> })
    .cookies;
  return cookies?.[ACCESS_TOKEN_COOKIE] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly tokenRevocation: TokenRevocationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.usersService.findByIdWithRoles(payload.sub);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User is not active');
    }

    if (await this.tokenRevocation.isRevoked(payload, user)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Load roles fresh from the DB so role changes apply without re-login.
    const roles = user.roles?.map((role) => role.name) ?? [];
    return { userId: user.id, email: user.email, roles };
  }
}
