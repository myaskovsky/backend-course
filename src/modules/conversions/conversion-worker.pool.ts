import { availableParallelism } from 'node:os';
import { extname, join } from 'node:path';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Piscina } from 'piscina';

import { ConfigService } from '@/core/config/config.service';

import { ConversionErrorCode } from './conversions.constants';
import type {
  ConversionOutcome,
  ConversionTask,
} from './worker/conversion-task';

/**
 * Pool of worker threads that run conversions (worker/conversion.worker.ts).
 *
 * - CPU-bound parsing/serialization never blocks the main event loop.
 * - CONVERT_TIMEOUT_MS is a real timeout: the task is aborted and its thread
 *   terminated (a fresh one replaces it), instead of checking the clock after
 *   the work is already done.
 *
 * Threads are started lazily on the first conversion and shut down with the
 * application.
 */
@Injectable()
export class ConversionWorkerPool implements OnModuleDestroy {
  private readonly logger = new Logger(ConversionWorkerPool.name);
  private pool: Piscina<ConversionTask, ConversionOutcome> | null = null;

  constructor(private readonly configService: ConfigService) {}

  async run(task: ConversionTask): Promise<ConversionOutcome> {
    const timeoutMs = Number(this.configService.get('CONVERT_TIMEOUT_MS'));
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return await this.getPool().run(task, { signal });
    } catch (err) {
      if (signal.aborted) {
        return {
          ok: false,
          code: ConversionErrorCode.TIMEOUT,
          message: `Conversion exceeded the time limit of ${timeoutMs}ms`,
        };
      }
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.destroy();
      this.pool = null;
    }
  }

  private getPool(): Piscina<ConversionTask, ConversionOutcome> {
    if (!this.pool) {
      const configured = Number(
        this.configService.get('CONVERT_WORKER_POOL_SIZE'),
      );
      const size =
        configured > 0 ? configured : Math.max(1, availableParallelism() - 1);

      // Built app: the worker is compiled to .js next to this file. Dev/tests
      // run from .ts sources, so the worker thread registers ts-node itself.
      const ext = extname(__filename);
      this.pool = new Piscina<ConversionTask, ConversionOutcome>({
        filename: join(__dirname, 'worker', `conversion.worker${ext}`),
        minThreads: 0,
        maxThreads: size,
        idleTimeout: 60_000,
        execArgv:
          ext === '.ts' ? ['-r', 'ts-node/register/transpile-only'] : [],
      });
      this.logger.log(`Conversion worker pool started (max ${size} threads)`);
    }
    return this.pool;
  }
}
