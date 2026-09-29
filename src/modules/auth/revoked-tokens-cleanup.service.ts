import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';

import { TokenRevocationService } from './token-revocation.service';

/**
 * Background job that drops denylist rows of tokens that have expired (and are
 * therefore rejected by the signature check anyway). Runs once at startup and
 * then every REVOKED_TOKENS_CLEANUP_INTERVAL_MS on an unref'd timer.
 */
@Injectable()
export class RevokedTokensCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RevokedTokensCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly tokenRevocation: TokenRevocationService,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(
      this.configService.get('REVOKED_TOKENS_CLEANUP_INTERVAL_MS'),
    );
    void this.run();
    this.timer = setInterval(() => void this.run(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Exposed for manual invocation/testing. */
  async run(): Promise<void> {
    try {
      const removed = await this.tokenRevocation.purgeExpired();
      if (removed > 0) {
        this.logger.log(`Purged ${removed} expired revoked token(s)`);
      }
    } catch (err) {
      this.logger.error(`Revoked-token cleanup failed: ${String(err)}`);
    }
  }
}
