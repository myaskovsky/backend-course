import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  RequestTimeoutException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { FileStorage } from '@/modules/storage/file-storage';

import { assertWithinDepth } from './codecs/depth-guard';
import { CodecError } from './codecs/codec-error';
import { CodecRegistry } from './codecs/codec.registry';
import {
  ConversionErrorCode,
  CONTENT_TYPES,
  EXTENSIONS,
  formatFromExtension,
  isSupportedPair,
  SIZE_LIMIT_CONFIG_KEY,
  TEXT_FORMATS,
  TextFormat,
} from './conversions.constants';
import { FormatPairDto } from './dto/formats-response.dto';
import {
  TransformationHistory,
  TransformationStatus,
  TransformationType,
} from './entities/transformation-history.entity';

export interface ConvertInput {
  userId: string;
  /** Original upload filename (used for source-format detection). */
  filename: string | undefined;
  /** Raw `targetFormat` field value from the multipart body. */
  targetFormatRaw: string | undefined;
  buffer: Buffer;
  /** When true, persist the result file to storage for later download. */
  save?: boolean;
}

export interface ConvertResult {
  stream: Readable;
  contentType: string;
  filename: string;
}

@Injectable()
export class ConversionsService {
  private readonly logger = new Logger(ConversionsService.name);

  constructor(
    @InjectRepository(TransformationHistory)
    private readonly historyRepo: Repository<TransformationHistory>,
    private readonly registry: CodecRegistry,
    private readonly configService: ConfigService,
    private readonly storage: FileStorage,
  ) {}

  /** All 12 supported source→target directions. */
  listFormats(): FormatPairDto[] {
    return TEXT_FORMATS.map((source) => ({
      source,
      target: TEXT_FORMATS.filter((target) => isSupportedPair(source, target)),
    }));
  }

  async convert(input: ConvertInput): Promise<ConvertResult> {
    const fileSize = input.buffer.length;

    // Request-shape validation (no history recorded — the request never named a
    // valid transformation).
    const target = this.parseTargetFormat(input.targetFormatRaw);
    const source = this.detectSourceFormat(input.filename);

    const started = Date.now();
    try {
      this.assertNotEmpty(input.buffer);
      this.assertWithinSizeLimit(source, fileSize);
      this.assertSupportedPair(source, target);

      const output = this.transform(source, target, input.buffer, started);
      const buffer = Buffer.from(output, 'utf8');
      const durationMs = Date.now() - started;

      // Saving is best-effort and never changes the conversion response: the
      // client always gets its converted file, even if persistence is skipped
      // (oversize) or fails (storage error). See the requirement note in 1.3.1.
      const saved = input.save ? await this.trySave(buffer) : null;

      await this.record(input.userId, source, target, {
        status: TransformationStatus.SUCCESS,
        errorCode: null,
        fileSize,
        durationMs,
        fileId: saved?.fileId ?? null,
        resultSize: saved?.size ?? null,
        expiresAt: this.computeExpiry(),
      });
      this.audit(
        input.userId,
        source,
        target,
        fileSize,
        durationMs,
        saved ? `success saved fileId=${saved.fileId}` : 'success',
      );

      return {
        stream: Readable.from(buffer),
        contentType: CONTENT_TYPES[target],
        filename: `converted.${EXTENSIONS[target]}`,
      };
    } catch (err) {
      const durationMs = Date.now() - started;
      const code =
        err instanceof CodecError
          ? err.code
          : ConversionErrorCode.INVALID_SYNTAX;

      await this.record(input.userId, source, target, {
        status: TransformationStatus.ERROR,
        errorCode: code,
        fileSize,
        durationMs,
        fileId: null,
        resultSize: null,
        expiresAt: this.computeExpiry(),
      });
      this.audit(
        input.userId,
        source,
        target,
        fileSize,
        durationMs,
        `error:${code}`,
      );
      throw this.toHttp(err);
    }
  }

  // ---- transformation ----

  private transform(
    source: TextFormat,
    target: TextFormat,
    buffer: Buffer,
    started: number,
  ): string {
    const text = this.decodeUtf8(buffer);
    const ir = this.registry.get(source).parse(text);
    assertWithinDepth(ir, this.maxDepth());
    const output = this.registry.get(target).serialize(ir);

    // Soft timeout: parsing is synchronous/CPU-bound so this cannot preempt an
    // in-progress transform — the per-format size limit and depth guard are the
    // real resource-attack defenses. This records/enforces the boundary after
    // the fact for observability and to fail unusually slow conversions.
    if (Date.now() - started > this.timeoutMs()) {
      throw new CodecError(
        ConversionErrorCode.TIMEOUT,
        'Conversion exceeded the time limit',
      );
    }
    return output;
  }

  /** Decodes UTF-8 and strips a leading BOM. */
  private decodeUtf8(buffer: Buffer): string {
    const text = buffer.toString('utf8');
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  // ---- validation ----

  private parseTargetFormat(raw: string | undefined): TextFormat {
    if (!raw) {
      throw new BadRequestException('targetFormat is required');
    }
    const value = raw.toLowerCase();
    if (!(TEXT_FORMATS as readonly string[]).includes(value)) {
      throw new BadRequestException(
        `Unsupported targetFormat: ${raw}. Supported: ${TEXT_FORMATS.join(', ')}`,
      );
    }
    return value as TextFormat;
  }

  private detectSourceFormat(filename: string | undefined): TextFormat {
    const ext = filename?.includes('.')
      ? filename.split('.').pop()!
      : undefined;
    const format = ext ? formatFromExtension(ext) : undefined;
    if (!format) {
      throw new UnsupportedMediaTypeException(
        `Unsupported or undetectable source format for file "${filename ?? ''}"`,
      );
    }
    return format;
  }

  private assertNotEmpty(buffer: Buffer): void {
    if (buffer.length === 0) {
      throw new CodecError(ConversionErrorCode.EMPTY_FILE, 'File is empty');
    }
  }

  private assertWithinSizeLimit(source: TextFormat, size: number): void {
    const limit = Number(this.configService.get(SIZE_LIMIT_CONFIG_KEY[source]));
    if (size > limit) {
      throw new CodecError(
        ConversionErrorCode.FILE_TOO_LARGE,
        `File exceeds the ${source.toUpperCase()} size limit of ${limit} bytes`,
      );
    }
  }

  private assertSupportedPair(source: TextFormat, target: TextFormat): void {
    if (!isSupportedPair(source, target)) {
      throw new CodecError(
        ConversionErrorCode.UNSUPPORTED_PAIR,
        `Cannot convert ${source} to ${target}`,
      );
    }
  }

  // ---- persistence & mapping ----

  /**
   * Persists the result to storage under a new fileId. Best-effort: returns null
   * (and logs) when the result exceeds the save-size limit or the storage write
   * fails, so the conversion response is unaffected.
   */
  private async trySave(
    buffer: Buffer,
  ): Promise<{ fileId: string; size: number } | null> {
    const max = Number(this.configService.get('CONVERT_MAX_SAVE_SIZE'));
    if (buffer.length > max) {
      this.logger.warn(
        `Result not saved: ${buffer.length} bytes exceeds CONVERT_MAX_SAVE_SIZE (${max})`,
      );
      return null;
    }
    const fileId = randomUUID();
    try {
      await this.storage.save(fileId, buffer);
      return { fileId, size: buffer.length };
    } catch (err) {
      this.logger.error(`Failed to save result file: ${String(err)}`);
      return null;
    }
  }

  private computeExpiry(): Date {
    const days = Number(this.configService.get('HISTORY_RETENTION_DAYS'));
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async record(
    userId: string,
    source: TextFormat,
    target: TextFormat,
    fields: {
      status: TransformationStatus;
      errorCode: string | null;
      fileSize: number;
      durationMs: number;
      fileId: string | null;
      resultSize: number | null;
      expiresAt: Date;
    },
  ): Promise<void> {
    const record = this.historyRepo.create({
      userId,
      type: TransformationType.FILE,
      sourceFormat: source,
      targetFormat: target,
      ...fields,
    });
    await this.historyRepo.save(record);
  }

  /** Audit line — never includes file contents. */
  private audit(
    userId: string,
    source: TextFormat,
    target: TextFormat,
    fileSize: number,
    durationMs: number,
    result: string,
  ): void {
    this.logger.log(
      `convert user=${userId} ${source}->${target} size=${fileSize} durationMs=${durationMs} result=${result}`,
    );
  }

  private toHttp(err: unknown): HttpException {
    if (err instanceof HttpException) {
      return err;
    }
    if (err instanceof CodecError) {
      switch (err.code) {
        case ConversionErrorCode.FILE_TOO_LARGE:
          return new PayloadTooLargeException(err.message);
        case ConversionErrorCode.TIMEOUT:
          return new RequestTimeoutException(err.message);
        default:
          return new BadRequestException(err.message);
      }
    }
    // Unknown/unexpected failure — do not leak internals.
    this.logger.error(`Unexpected conversion failure: ${String(err)}`);
    return new BadRequestException('Conversion failed');
  }

  private maxDepth(): number {
    return Number(this.configService.get('CONVERT_MAX_DEPTH'));
  }

  private timeoutMs(): number {
    return Number(this.configService.get('CONVERT_TIMEOUT_MS'));
  }
}
