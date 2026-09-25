import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { Injectable, Logger } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';

import { FileStorage } from './file-storage';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Local-disk implementation of FileStorage. Files live under STORAGE_DIR,
 * sharded by the first two characters of the fileId to keep directories small.
 * fileId is validated as a UUID before being used in a path, which prevents
 * path traversal.
 */
@Injectable()
export class LocalDiskStorage extends FileStorage {
  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly baseDir: string;

  constructor(configService: ConfigService) {
    super();
    const configured = configService.get('STORAGE_DIR');
    this.baseDir = isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured);
  }

  async save(fileId: string, data: Buffer): Promise<void> {
    const path = this.pathFor(fileId);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, data);
  }

  createReadStream(fileId: string): Readable {
    return createReadStream(this.pathFor(fileId));
  }

  exists(fileId: string): Promise<boolean> {
    return Promise.resolve(existsSync(this.pathFor(fileId)));
  }

  async remove(fileId: string): Promise<void> {
    try {
      await rm(this.pathFor(fileId), { force: true });
    } catch (err) {
      this.logger.warn(`Failed to remove file ${fileId}: ${String(err)}`);
    }
  }

  private pathFor(fileId: string): string {
    if (!UUID_RE.test(fileId)) {
      throw new Error(`Invalid fileId: ${fileId}`);
    }
    return join(this.baseDir, fileId.slice(0, 2), fileId);
  }
}
