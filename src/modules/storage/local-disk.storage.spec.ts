import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { ConfigService } from '@/core/config/config.service';

import { StorageLimitExceededError } from './file-storage';
import { LocalDiskStorage } from './local-disk.storage';

async function readAll(stream: Readable): Promise<string> {
  let out = '';
  for await (const chunk of stream) {
    out += String(chunk);
  }
  return out;
}

/** Temp files are deleted asynchronously after the stream closes. */
async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met in time');
}

describe('LocalDiskStorage', () => {
  let dir: string;
  let storage: LocalDiskStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'storage-spec-'));
    storage = new LocalDiskStorage({
      get: () => dir,
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const tempFiles = () => readdir(join(dir, '.tmp')).catch(() => []);

  it('resolves a relative STORAGE_DIR against the working directory', () => {
    const relative = new LocalDiskStorage({
      get: () => './storage/x',
    } as unknown as ConfigService);
    expect(
      (relative as unknown as { baseDir: string }).baseDir.startsWith(
        process.cwd(),
      ),
    ).toBe(true);
  });

  describe('temp files', () => {
    it('streams a source into a temp file and reports its size', async () => {
      const temp = await storage.writeTemp(Readable.from(['ab', 'cd']), 10);
      expect(temp.size).toBe(4);
      expect(temp.path.startsWith(join(dir, '.tmp'))).toBe(true);
      await expect(readFile(temp.path, 'utf8')).resolves.toBe('abcd');
    });

    it('rejects a stream over the limit, deletes it and still consumes the source', async () => {
      const source = Readable.from(['abc', 'def', 'ghi']);
      await expect(storage.writeTemp(source, 5)).rejects.toBeInstanceOf(
        StorageLimitExceededError,
      );
      expect(source.readableEnded).toBe(true);
      expect(await tempFiles()).toHaveLength(0);
    });

    it('deletes the partial file when the source fails', async () => {
      const source = new Readable({
        read() {
          this.push('abc');
          this.destroy(new Error('connection reset'));
        },
      });
      await expect(storage.writeTemp(source, 100)).rejects.toThrow(
        'connection reset',
      );
      expect(await tempFiles()).toHaveLength(0);
    });

    it('deletes a temp file once its read stream is consumed', async () => {
      const temp = await storage.writeTemp(Readable.from(['hello']), 10);
      await expect(
        readAll(storage.createTempReadStream(temp.path)),
      ).resolves.toBe('hello');
      await waitFor(async () => (await tempFiles()).length === 0);
    });

    it('refuses paths outside the temp directory', async () => {
      expect(() => storage.createTempReadStream('/etc/passwd')).toThrow(
        'outside the temp directory',
      );
      await expect(
        storage.moveIn(join(dir, '.tmp', '..', 'escape'), randomUUID()),
      ).rejects.toThrow('outside the temp directory');
    });

    it('purges stale temp files at startup, keeping recent ones', async () => {
      const stale = await storage.createTempPath();
      const fresh = await storage.createTempPath();
      await writeFile(stale, 'old');
      await writeFile(fresh, 'new');
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(stale, twoHoursAgo, twoHoursAgo);

      await storage.onModuleInit();

      expect(await tempFiles()).toEqual([fresh.split('/').pop()]);
    });

    it('purgeStaleTemp is a no-op without a temp directory', async () => {
      await expect(storage.purgeStaleTemp(Date.now())).resolves.toBe(0);
    });
  });

  describe('saved files', () => {
    it('moves a temp file into sharded storage', async () => {
      const fileId = randomUUID();
      const temp = await storage.writeTemp(Readable.from(['result']), 100);

      await storage.moveIn(temp.path, fileId);

      expect(await storage.exists(fileId)).toBe(true);
      expect(await readdir(join(dir, fileId.slice(0, 2)))).toEqual([fileId]);
      await expect(readAll(storage.createReadStream(fileId))).resolves.toBe(
        'result',
      );
      expect(await tempFiles()).toHaveLength(0);
    });

    it('exists is false for an unknown id and remove is idempotent', async () => {
      const fileId = randomUUID();
      expect(await storage.exists(fileId)).toBe(false);
      await expect(storage.remove(fileId)).resolves.toBeUndefined();
    });

    it('removes a saved file', async () => {
      const fileId = randomUUID();
      await storage.moveIn(
        (await storage.writeTemp(Readable.from(['x']), 10)).path,
        fileId,
      );
      await storage.remove(fileId);
      expect(await storage.exists(fileId)).toBe(false);
    });

    it('rejects non-UUID ids (path traversal)', async () => {
      expect(() => storage.createReadStream('../../etc/passwd')).toThrow(
        'Invalid fileId',
      );
      expect(await storage.exists('../secret')).toBe(false);
    });
  });
});
