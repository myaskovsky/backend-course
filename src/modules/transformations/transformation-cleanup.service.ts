import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';

import { TransformationsService } from './transformations.service';

/**
 * Background job that deletes expired history records and their saved files.
 * Runs once at startup and then every HISTORY_CLEANUP_INTERVAL_MS. Uses a plain
 * timer (unref'd so it never keeps the process alive) — no external scheduler
 * dependency.
 */
@Injectable()
export class TransformationCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TransformationCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly transformationsService: TransformationsService,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(
      this.configService.get('HISTORY_CLEANUP_INTERVAL_MS'),
    );
    void this.run();
    this.timer = setInterval(() => void this.run(), intervalMs);
    this.timer.unref();
    this.logger.log(`Cleanup job scheduled every ${intervalMs}ms`);
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
      const removed = await this.transformationsService.purgeExpired();
      if (removed > 0) {
        this.logger.log(`Cleanup removed ${removed} expired record(s)`);
      }
    } catch (err) {
      this.logger.error(`Cleanup failed: ${String(err)}`);
    }
  }
}
