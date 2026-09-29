import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import type { User } from '@/modules/users/entities/user.entity';

import { JwtPayload } from './auth.constants';
import { RevokedToken } from './entities/revoked-token.entity';

/**
 * Server-side token revocation. Two mechanisms cover the two cases:
 *  - a single token (logout, refresh rotation) goes into the `revoked_tokens`
 *    denylist, keyed by its `jti`, until it would have expired anyway;
 *  - all tokens of a user (password change/reset, delete, block) are revoked
 *    by `users.tokensValidAfter` — see UsersService.
 */
@Injectable()
export class TokenRevocationService {
  constructor(
    @InjectRepository(RevokedToken)
    private readonly revokedRepo: Repository<RevokedToken>,
  ) {}

  /**
   * Adds the token to the denylist. Returns false when it was already revoked,
   * which on refresh means the token is being replayed. The insert is atomic,
   * so two concurrent refreshes with the same token cannot both succeed.
   */
  async revoke(payload: JwtPayload): Promise<boolean> {
    const result = await this.revokedRepo
      .createQueryBuilder()
      .insert()
      .into(RevokedToken)
      .values({
        jti: payload.jti,
        userId: payload.sub,
        type: payload.type,
        expiresAt: new Date(payload.exp * 1000),
      })
      .orIgnore()
      .returning(['jti'])
      .execute();
    return (result.raw as unknown[]).length > 0;
  }

  /** True if the token was revoked individually or by a revoke-all. */
  async isRevoked(
    payload: JwtPayload,
    user: Pick<User, 'tokensValidAfter'>,
  ): Promise<boolean> {
    if (this.isRevokedForUser(payload, user)) {
      return true;
    }
    return this.revokedRepo.exists({ where: { jti: payload.jti } });
  }

  /**
   * True if the token predates the user's last revoke-all. Tokens without a
   * `jti` (issued before revocation support existed) are rejected as well,
   * since they could never be revoked individually.
   */
  isRevokedForUser(
    payload: JwtPayload,
    user: Pick<User, 'tokensValidAfter'>,
  ): boolean {
    if (!payload.jti) {
      return true;
    }
    return (
      user.tokensValidAfter !== null &&
      payload.iat * 1000 < user.tokensValidAfter.getTime()
    );
  }

  /** Deletes denylist rows whose tokens have expired. Returns the count. */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const result = await this.revokedRepo.delete({ expiresAt: LessThan(now) });
    return result.affected ?? 0;
  }
}
