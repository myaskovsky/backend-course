import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';

import {
  FileStorage,
  StorageLimitExceededError,
  TempFile,
} from './file-storage';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Temp files older than this are leftovers of a crash and are deleted at startup. */
const STALE_TEMP_MS = 60 * 60 * 1000;

/**
 * Local-disk implementation of FileStorage. Files live under STORAGE_DIR,
 * sharded by the first two characters of the fileId to keep directories small;
 * scratch files live in STORAGE_DIR/.tmp (same filesystem, so moving a result
 * into storage is an atomic rename). fileIds are validated as UUIDs and temp
 * paths must resolve inside the temp directory, which prevents path traversal.
 */
@Injectable()
export class LocalDiskStorage extends FileStorage implements OnModuleInit {
  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly baseDir: string;
  private readonly tempDir: string;

  constructor(configService: ConfigService) {
    super();
    const configured = configService.get('STORAGE_DIR');
    this.baseDir = isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured);
    this.tempDir = join(this.baseDir, '.tmp');
  }

  async onModuleInit(): Promise<void> {
    await this.purgeStaleTemp(Date.now() - STALE_TEMP_MS);
  }

  createReadStream(fileId: string): Readable {
    return createReadStream(this.pathFor(fileId));
  }

  async exists(fileId: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(fileId))).isFile();
    } catch {
      return false;
    }
  }

  async remove(fileId: string): Promise<void> {
    try {
      await rm(this.pathFor(fileId), { force: true });
    } catch (err) {
      this.logger.warn(`Failed to remove file ${fileId}: ${String(err)}`);
    }
  }

  async createTempPath(): Promise<string> {
    await mkdir(this.tempDir, { recursive: true });
    return join(this.tempDir, randomUUID());
  }

  async writeTemp(source: Readable, maxBytes: number): Promise<TempFile> {
    const path = await this.createTempPath();
    let size = 0;
    // Past the limit, further bytes are dropped rather than failing the
    // pipeline: `source` (e.g. a multipart part) is still read to its end, so
    // the request body stays consumable, but nothing more reaches the disk.
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length;
        done(null, size > maxBytes ? undefined : chunk);
      },
    });
    try {
      await pipeline(source, limiter, createWriteStream(path));
    } catch (err) {
      await this.removeTemp(path);
      throw err;
    }
    if (size > maxBytes) {
      await this.removeTemp(path);
      throw new StorageLimitExceededError(maxBytes);
    }
    return { path, size };
  }

  async moveIn(tempPath: string, fileId: string): Promise<void> {
    const target = this.pathFor(fileId);
    await mkdir(dirname(target), { recursive: true });
    await rename(this.tempPathOrThrow(tempPath), target);
  }

  createTempReadStream(tempPath: string): Readable {
    const stream = createReadStream(this.tempPathOrThrow(tempPath));
    stream.once('close', () => void this.removeTemp(tempPath));
    return stream;
  }

  async removeTemp(tempPath: string): Promise<void> {
    try {
      await rm(this.tempPathOrThrow(tempPath), { force: true });
    } catch (err) {
      this.logger.warn(`Failed to remove temp file: ${String(err)}`);
    }
  }

  /** Deletes temp files last modified before `olderThan` (epoch ms). */
  async purgeStaleTemp(olderThan: number): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.tempDir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      const path = join(this.tempDir, name);
      try {
        if ((await stat(path)).mtimeMs < olderThan) {
          await rm(path, { force: true });
          removed++;
        }
      } catch {
        // vanished concurrently — nothing to do
      }
    }
    return removed;
  }

  private pathFor(fileId: string): string {
    if (!UUID_RE.test(fileId)) {
      throw new Error(`Invalid fileId: ${fileId}`);
    }
    return join(this.baseDir, fileId.slice(0, 2), fileId);
  }

  private tempPathOrThrow(tempPath: string): string {
    const resolved = resolve(tempPath);
    if (!resolved.startsWith(this.tempDir + sep)) {
      throw new Error('Path is outside the temp directory');
    }
    return resolved;
  }
}
