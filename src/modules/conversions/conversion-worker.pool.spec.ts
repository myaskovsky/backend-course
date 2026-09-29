import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@/core/config/config.service';

import { ConversionWorkerPool } from './conversion-worker.pool';
import { ConversionErrorCode, TextFormat } from './conversions.constants';

/**
 * Runs real worker threads (the .ts worker is loaded through ts-node inside
 * the thread), so these tests cover the thread boundary itself: structured
 * outcomes, error codes surviving serialization, and the hard timeout.
 */
describe('ConversionWorkerPool', () => {
  let dir: string;
  let values: Record<string, number>;
  let pool: ConversionWorkerPool;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worker-pool-spec-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    values = { CONVERT_TIMEOUT_MS: 30_000, CONVERT_WORKER_POOL_SIZE: 1 };
    pool = new ConversionWorkerPool({
      get: (key: string) => values[key],
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    await pool.onModuleDestroy();
  });

  const task = async (name: string, content: string) => {
    const inputPath = join(dir, `${name}.in`);
    await writeFile(inputPath, content);
    return {
      inputPath,
      outputPath: join(dir, `${name}.out`),
      source: TextFormat.JSON,
      target: TextFormat.CSV,
      maxDepth: 100,
    };
  };

  it('converts a file in a worker thread', async () => {
    const t = await task('ok', '[{"a":1,"b":"x"},{"a":2}]');
    await expect(pool.run(t)).resolves.toEqual({ ok: true, resultSize: 11 });
    await expect(readFile(t.outputPath, 'utf8')).resolves.toBe(
      'a,b\n1,x\n2,\n',
    );
  }, 30_000);

  it('returns codec errors as structured outcomes', async () => {
    const t = await task('bad', '{"a":');
    await expect(pool.run(t)).resolves.toMatchObject({
      ok: false,
      code: ConversionErrorCode.INVALID_SYNTAX,
    });
  }, 30_000);

  it('terminates a conversion that exceeds CONVERT_TIMEOUT_MS', async () => {
    values.CONVERT_TIMEOUT_MS = 1;
    const rows = Array.from({ length: 50_000 }, (_, i) => ({ id: i, v: 'x' }));
    const t = await task('slow', JSON.stringify(rows));
    await expect(pool.run(t)).resolves.toEqual({
      ok: false,
      code: ConversionErrorCode.TIMEOUT,
      message: 'Conversion exceeded the time limit of 1ms',
    });
  }, 30_000);

  it('can be destroyed before it was ever used', async () => {
    await expect(pool.onModuleDestroy()).resolves.toBeUndefined();
  });
});
