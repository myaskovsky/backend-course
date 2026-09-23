import { Readable } from 'node:stream';

import {
  BadRequestException,
  Logger,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { FileStorage } from '@/modules/storage/file-storage';

import { CsvCodec } from './codecs/csv.codec';
import { CodecRegistry } from './codecs/codec.registry';
import { JsonCodec } from './codecs/json.codec';
import { XmlCodec } from './codecs/xml.codec';
import { YamlCodec } from './codecs/yaml.codec';
import { ConversionsService } from './conversions.service';
import { ConversionErrorCode } from './conversions.constants';
import {
  TransformationHistory,
  TransformationStatus,
} from './entities/transformation-history.entity';

async function readStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function setup(configValues: Record<string, string | number> = {}): {
  service: ConversionsService;
  save: jest.Mock;
  storageSave: jest.Mock;
} {
  const registry = new CodecRegistry(
    new CsvCodec(),
    new JsonCodec(),
    new XmlCodec(),
    new YamlCodec(),
  );
  const save = jest.fn().mockResolvedValue(undefined);
  const historyRepo = {
    create: jest.fn((x: Partial<TransformationHistory>) => x),
    save,
  } as unknown as Repository<TransformationHistory>;

  const storageSave = jest.fn().mockResolvedValue(undefined);
  const storage = {
    save: storageSave,
    createReadStream: jest.fn(),
    exists: jest.fn().mockResolvedValue(true),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as FileStorage;

  const values: Record<string, string | number> = {
    CONVERT_MAX_SIZE_CSV: 5_000_000,
    CONVERT_MAX_SIZE_JSON: 5_000_000,
    CONVERT_MAX_SIZE_XML: 5_000_000,
    CONVERT_MAX_SIZE_YAML: 5_000_000,
    CONVERT_TIMEOUT_MS: 30_000,
    CONVERT_MAX_DEPTH: 100,
    CONVERT_MAX_SAVE_SIZE: 10_485_760,
    HISTORY_RETENTION_DAYS: 90,
    ...configValues,
  };
  const configService = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;

  return {
    service: new ConversionsService(
      historyRepo,
      registry,
      configService,
      storage,
    ),
    save,
    storageSave,
  };
}

describe('ConversionsService', () => {
  describe('listFormats', () => {
    it('returns 12 directions (each of 4 sources -> 3 targets)', () => {
      const { service } = setup();
      const pairs = service.listFormats();
      expect(pairs).toHaveLength(4);
      expect(pairs.every((p) => p.target.length === 3)).toBe(true);
      expect(pairs.every((p) => !p.target.includes(p.source))).toBe(true);
    });
  });

  describe('convert', () => {
    const base = {
      userId: 'u1',
      filename: 'data.json',
      targetFormatRaw: 'yaml',
    };

    it('converts JSON to YAML and records a success', async () => {
      const { service, save } = setup();
      const result = await service.convert({
        ...base,
        buffer: Buffer.from('{"name":"Ann"}', 'utf8'),
      });

      expect(result.filename).toBe('converted.yaml');
      expect(result.contentType).toContain('application/yaml');
      await expect(readStream(result.stream)).resolves.toContain('name: Ann');

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][0]).toMatchObject({
        userId: 'u1',
        sourceFormat: 'json',
        targetFormat: 'yaml',
        status: TransformationStatus.SUCCESS,
        errorCode: null,
      });
    });

    it('saves the result and records fileId when save=true', async () => {
      const { service, save, storageSave } = setup();
      await service.convert({
        ...base,
        save: true,
        buffer: Buffer.from('{"name":"Ann"}', 'utf8'),
      });

      expect(storageSave).toHaveBeenCalledTimes(1);
      const record = save.mock.calls[0][0] as {
        fileId: string | null;
        resultSize: number | null;
        expiresAt: Date;
      };
      expect(record.fileId).toEqual(expect.any(String));
      expect(record.resultSize).toEqual(expect.any(Number));
      expect(record.expiresAt).toBeInstanceOf(Date);
    });

    it('skips saving (best-effort) when the result exceeds the save limit', async () => {
      const { service, save, storageSave } = setup({
        CONVERT_MAX_SAVE_SIZE: 4,
      });
      const result = await service.convert({
        ...base,
        save: true,
        buffer: Buffer.from('{"name":"Ann"}', 'utf8'),
      });

      // Conversion still succeeds and returns the file...
      await expect(readStream(result.stream)).resolves.toContain('name: Ann');
      // ...but nothing was persisted to storage and no fileId was recorded.
      expect(storageSave).not.toHaveBeenCalled();
      expect(
        (save.mock.calls[0][0] as { fileId: string | null }).fileId,
      ).toBeNull();
    });

    it('does not save when save is false', async () => {
      const { service, save, storageSave } = setup();
      await service.convert({
        ...base,
        buffer: Buffer.from('{"name":"Ann"}', 'utf8'),
      });
      expect(storageSave).not.toHaveBeenCalled();
      expect(
        (save.mock.calls[0][0] as { fileId: string | null }).fileId,
      ).toBeNull();
    });

    it('rejects a missing/invalid targetFormat with 400 and no history', async () => {
      const { service, save } = setup();
      await expect(
        service.convert({
          ...base,
          targetFormatRaw: 'toml',
          buffer: Buffer.from('{}', 'utf8'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save).not.toHaveBeenCalled();
    });

    it('rejects an unknown source extension with 415 and no history', async () => {
      const { service, save } = setup();
      await expect(
        service.convert({
          ...base,
          filename: 'data.bin',
          buffer: Buffer.from('{}', 'utf8'),
        }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
      expect(save).not.toHaveBeenCalled();
    });

    it('rejects an oversize file with 413 and records the error', async () => {
      const { service, save } = setup({ CONVERT_MAX_SIZE_JSON: 4 });
      await expect(
        service.convert({
          ...base,
          buffer: Buffer.from('{"name":"Ann"}', 'utf8'),
        }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(save.mock.calls[0][0]).toMatchObject({
        status: TransformationStatus.ERROR,
        errorCode: ConversionErrorCode.FILE_TOO_LARGE,
      });
    });

    it('rejects an empty file with 400 and records the error', async () => {
      const { service, save } = setup();
      await expect(
        service.convert({ ...base, buffer: Buffer.alloc(0) }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save.mock.calls[0][0]).toMatchObject({
        status: TransformationStatus.ERROR,
        errorCode: ConversionErrorCode.EMPTY_FILE,
      });
    });

    it('rejects an unsupported (identity) pair and records the error', async () => {
      const { service, save } = setup();
      await expect(
        service.convert({
          ...base,
          targetFormatRaw: 'json',
          buffer: Buffer.from('{}', 'utf8'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save.mock.calls[0][0]).toMatchObject({
        errorCode: ConversionErrorCode.UNSUPPORTED_PAIR,
      });
    });

    it('rejects malformed source syntax with 400 and records the error', async () => {
      const { service, save } = setup();
      await expect(
        service.convert({ ...base, buffer: Buffer.from('{bad', 'utf8') }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save.mock.calls[0][0]).toMatchObject({
        errorCode: ConversionErrorCode.INVALID_SYNTAX,
      });
    });

    it('never writes file contents to the audit log', async () => {
      const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const { service } = setup();
      const secret = 'TOP_SECRET_CONTENT';
      await service.convert({
        ...base,
        buffer: Buffer.from(`{"data":"${secret}"}`, 'utf8'),
      });
      for (const call of spy.mock.calls) {
        expect(String(call[0])).not.toContain(secret);
      }
      spy.mockRestore();
    });
  });
});
