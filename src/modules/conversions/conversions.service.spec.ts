import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import {
  BadRequestException,
  Logger,
  PayloadTooLargeException,
  RequestTimeoutException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { LocalDiskStorage } from '@/modules/storage/local-disk.storage';

import { ConversionWorkerPool } from './conversion-worker.pool';
import { ConversionErrorCode } from './conversions.constants';
import { ConversionsService, StagedUpload } from './conversions.service';
import {
  TransformationHistory,
  TransformationStatus,
} from './entities/transformation-history.entity';
import convertInWorker from './worker/conversion.worker';

async function readStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Temp files are deleted asynchronously after the stream closes. */
async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met in time');
}

describe('ConversionsService', () => {
  let dir: string;
  let storage: LocalDiskStorage;
  let historySave: jest.Mock;
  let workerRun: jest.Mock;
  let service: ConversionsService;
  let values: Record<string, string | number>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conversions-spec-'));
    values = {
      STORAGE_DIR: dir,
      CONVERT_MAX_SIZE_CSV: 5_000_000,
      CONVERT_MAX_SIZE_JSON: 5_000_000,
      CONVERT_MAX_SIZE_XML: 5_000_000,
      CONVERT_MAX_SIZE_YAML: 5_000_000,
      CONVERT_TIMEOUT_MS: 30_000,
      CONVERT_MAX_DEPTH: 100,
      CONVERT_MAX_SAVE_SIZE: 10_485_760,
      HISTORY_RETENTION_DAYS: 90,
    };
    const configService = {
      get: (key: string) => values[key],
    } as unknown as ConfigService;

    storage = new LocalDiskStorage(configService);
    historySave = jest.fn().mockResolvedValue(undefined);
    const historyRepo = {
      create: jest.fn((x: Partial<TransformationHistory>) => x),
      save: historySave,
    } as unknown as Repository<TransformationHistory>;
    // Run the real worker function in-process (no thread) by default.
    workerRun = jest.fn(convertInWorker);

    service = new ConversionsService(historyRepo, configService, storage, {
      run: workerRun,
    } as unknown as ConversionWorkerPool);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const stage = (filename: string, content: string | Buffer) =>
    service.stageUpload(filename, Readable.from([Buffer.from(content)]));

  const tempFiles = async () => {
    try {
      return await readdir(join(dir, '.tmp'));
    } catch {
      return [];
    }
  };

  const lastRecord = () =>
    historySave.mock.calls.at(-1)![0] as Partial<TransformationHistory>;

  describe('listFormats', () => {
    it('returns 12 directions (each of 4 sources -> 3 targets)', () => {
      const pairs = service.listFormats();
      expect(pairs).toHaveLength(4);
      expect(pairs.reduce((n, p) => n + p.target.length, 0)).toBe(12);
      for (const pair of pairs) {
        expect(pair.target).not.toContain(pair.source);
      }
    });
  });

  describe('stageUpload', () => {
    it('streams the upload to a temp file', async () => {
      const upload = await stage('data.json', '{"a":1}');
      expect(upload).toMatchObject({
        filename: 'data.json',
        source: 'json',
        size: 7,
      });
      expect(await tempFiles()).toHaveLength(1);
    });

    it('flags an upload over the per-format limit without keeping it', async () => {
      values.CONVERT_MAX_SIZE_JSON = 4;
      const upload = await stage('data.json', '{"a":1}');
      expect(upload.tooLarge).toBe(true);
      expect(upload.path).toBeUndefined();
      expect(await tempFiles()).toHaveLength(0);
    });

    it('drains an upload with an unsupported extension', async () => {
      const file = Readable.from([Buffer.from('hello')]);
      const upload = await service.stageUpload('notes.txt', file);
      expect(upload).toEqual({ filename: 'notes.txt', size: 0 });
      expect(file.readableEnded).toBe(true);
    });
  });

  describe('convert', () => {
    const run = (
      upload: StagedUpload | undefined,
      target = 'yaml',
      save = false,
    ) =>
      service.convert({ userId: 'u1', targetFormatRaw: target, upload, save });

    it('converts JSON to YAML via the worker and records a success', async () => {
      const result = await run(await stage('data.json', '{"name":"Ann"}'));

      expect(result.contentType).toBe('application/yaml; charset=utf-8');
      expect(result.filename).toBe('converted.yaml');
      expect(await readStream(result.stream)).toBe('name: Ann\n');
      expect(workerRun).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'json',
          target: 'yaml',
          maxDepth: 100,
        }),
      );
      expect(lastRecord()).toMatchObject({
        userId: 'u1',
        sourceFormat: 'json',
        targetFormat: 'yaml',
        status: TransformationStatus.SUCCESS,
        errorCode: null,
        fileSize: 14,
        fileId: null,
      });
    });

    it('deletes the input and output temp files once the response is read', async () => {
      const result = await run(await stage('data.csv', 'a,b\n1,2\n'), 'json');
      await readStream(result.stream);
      await waitFor(async () => (await tempFiles()).length === 0);
    });

    it('moves the result into storage and records fileId when save=true', async () => {
      const result = await run(
        await stage('data.json', '{"a":1}'),
        'yaml',
        true,
      );

      const record = lastRecord();
      expect(record.fileId).toMatch(/^[0-9a-f-]{36}$/);
      expect(record.resultSize).toBe(Buffer.byteLength('a: 1\n'));
      expect(await storage.exists(record.fileId!)).toBe(true);
      expect(await readStream(result.stream)).toBe('a: 1\n');
      expect(await tempFiles()).toHaveLength(0);
    });

    it('skips saving (best-effort) when the result exceeds the save limit', async () => {
      values.CONVERT_MAX_SAVE_SIZE = 1;
      const result = await run(
        await stage('data.json', '{"a":1}'),
        'yaml',
        true,
      );
      expect(lastRecord()).toMatchObject({
        status: TransformationStatus.SUCCESS,
        fileId: null,
        resultSize: null,
      });
      expect(await readStream(result.stream)).toBe('a: 1\n');
    });

    it('still returns the result when moving it into storage fails', async () => {
      jest.spyOn(storage, 'moveIn').mockRejectedValue(new Error('disk full'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const result = await run(
        await stage('data.json', '{"a":1}'),
        'yaml',
        true,
      );
      expect(lastRecord().fileId).toBeNull();
      expect(await readStream(result.stream)).toBe('a: 1\n');
    });

    it('rejects a missing/invalid targetFormat with 400 and no history', async () => {
      const upload = await stage('data.json', '{}');
      await expect(run(upload, '')).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        run(await stage('data.json', '{}'), 'pdf'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(historySave).not.toHaveBeenCalled();
      expect(await tempFiles()).toHaveLength(0);
    });

    it('rejects an unknown source extension or a missing file with 415', async () => {
      await expect(
        run(await service.stageUpload('notes.txt', Readable.from(['x']))),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
      await expect(run(undefined)).rejects.toBeInstanceOf(
        UnsupportedMediaTypeException,
      );
      expect(historySave).not.toHaveBeenCalled();
    });

    it('rejects an oversize file with 413 and records the error', async () => {
      values.CONVERT_MAX_SIZE_JSON = 4;
      await expect(
        run(await stage('data.json', '{"a":1}')),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(lastRecord()).toMatchObject({
        status: TransformationStatus.ERROR,
        errorCode: ConversionErrorCode.FILE_TOO_LARGE,
      });
      expect(workerRun).not.toHaveBeenCalled();
    });

    it('rejects an empty file with 400 and records the error', async () => {
      await expect(run(await stage('data.json', ''))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(lastRecord().errorCode).toBe(ConversionErrorCode.EMPTY_FILE);
    });

    it('rejects an unsupported (identity) pair and records the error', async () => {
      await expect(
        run(await stage('data.json', '{}'), 'json'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(lastRecord().errorCode).toBe(ConversionErrorCode.UNSUPPORTED_PAIR);
    });

    it('maps worker codec errors to 400 and records their code', async () => {
      await expect(
        run(await stage('data.json', '{bad')),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(lastRecord().errorCode).toBe(ConversionErrorCode.INVALID_SYNTAX);
      expect(await tempFiles()).toHaveLength(0);
    });

    it('rejects invalid UTF-8 with INVALID_ENCODING', async () => {
      await expect(
        run(await stage('data.json', Buffer.from([0x22, 0xff, 0x22]))),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(lastRecord().errorCode).toBe(ConversionErrorCode.INVALID_ENCODING);
    });

    it('rejects over-deep structures with DEPTH_EXCEEDED', async () => {
      values.CONVERT_MAX_DEPTH = 2;
      await expect(
        run(await stage('data.json', '{"a":{"b":{"c":1}}}')),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(lastRecord().errorCode).toBe(ConversionErrorCode.DEPTH_EXCEEDED);
    });

    it('maps a worker timeout to 408', async () => {
      workerRun.mockResolvedValue({
        ok: false,
        code: ConversionErrorCode.TIMEOUT,
        message: 'Conversion exceeded the time limit of 30000ms',
      });
      await expect(run(await stage('data.json', '{}'))).rejects.toBeInstanceOf(
        RequestTimeoutException,
      );
      expect(lastRecord().errorCode).toBe(ConversionErrorCode.TIMEOUT);
      expect(await tempFiles()).toHaveLength(0);
    });

    it('hides unexpected worker failures behind a generic 400', async () => {
      workerRun.mockRejectedValue(new Error('worker crashed: /secret/path'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      await expect(run(await stage('data.json', '{}'))).rejects.toThrow(
        'Conversion failed',
      );
    });

    it('never writes file contents to the audit log', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const result = await run(
        await stage('data.json', '{"secret":"top-secret-value"}'),
      );
      await readStream(result.stream);

      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('json->yaml'))).toBe(true);
      expect(lines.some((l) => l.includes('top-secret-value'))).toBe(false);
    });
  });

  it('discard removes a staged upload and ignores missing ones', async () => {
    const upload = await stage('data.json', '{}');
    await service.discard(upload);
    await service.discard(undefined);
    expect(await tempFiles()).toHaveLength(0);
  });
});
