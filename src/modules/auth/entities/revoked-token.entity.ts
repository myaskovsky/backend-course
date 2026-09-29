import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { TokenType } from '../auth.constants';

/**
 * A JWT revoked before its natural expiry (logout, refresh rotation). Kept only
 * until `expiresAt` — after that the signature check rejects the token anyway
 * and the row is purged by RevokedTokensCleanupService.
 */
@Entity({ name: 'revoked_tokens' })
@Index('idx_revoked_tokens_expires', ['expiresAt'])
export class RevokedToken {
  @PrimaryColumn({ type: 'uuid' })
  jti: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  type: TokenType;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  revokedAt: Date;
}
