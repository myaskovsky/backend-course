import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

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
import {
  FileStorage,
  StorageLimitExceededError,
} from '@/modules/storage/file-storage';

import { CodecError } from './codecs/codec-error';
import { ConversionWorkerPool } from './conversion-worker.pool';
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

/**
 * An upload streamed to a temp file (see `stageUpload`). `source` is undefined
 * when the filename has no supported extension; `tooLarge` when the upload
 * exceeded the limit of its source format (nothing is kept on disk then).
 */
export interface StagedUpload {
  filename: string;
  source?: TextFormat;
  path?: string;
  size: number;
  tooLarge?: boolean;
}

export interface ConvertInput {
  userId: string;
  /** Raw `targetFormat` field value from the multipart body. */
  targetFormatRaw: string | undefined;
  /** The uploaded file, or undefined when the request carried none. */
  upload: StagedUpload | undefined;
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
    private readonly configService: ConfigService,
    private readonly storage: FileStorage,
    private readonly workers: ConversionWorkerPool,
  ) {}

  /** All 12 supported source→target directions. */
  listFormats(): FormatPairDto[] {
    return TEXT_FORMATS.map((source) => ({
      source,
      target: TEXT_FORMATS.filter((target) => isSupportedPair(source, target)),
    }));
  }

  /**
   * Streams an uploaded file to a temp file, enforcing the size limit of its
   * source format while the bytes arrive — the upload is never held in memory.
   * The stream is always fully consumed, so the multipart parser can move on
   * to the fields that follow the file.
   */
  async stageUpload(filename: string, file: Readable): Promise<StagedUpload> {
    const source = this.detectSourceFormat(filename);
    if (!source) {
      await drain(file);
      return { filename, size: 0 };
    }
    const limit = this.sizeLimit(source);
    try {
      const temp = await this.storage.writeTemp(file, limit);
      return { filename, source, path: temp.path, size: temp.size };
    } catch (err) {
      if (err instanceof StorageLimitExceededError) {
        return { filename, source, size: limit + 1, tooLarge: true };
      }
      throw err;
    }
  }

  /** Discards a staged upload (e.g. when the request fails before `convert`). */
  async discard(upload: StagedUpload | undefined): Promise<void> {
    if (upload?.path) {
      await this.storage.removeTemp(upload.path);
    }
  }

  async convert(input: ConvertInput): Promise<ConvertResult> {
    const { upload } = input;
    let outputPath: string | undefined;
    try {
      // Request-shape validation (no history recorded — the request never
      // named a valid transformation).
      const target = this.parseTargetFormat(input.targetFormatRaw);
      const source = upload?.source;
      if (!source) {
        throw new UnsupportedMediaTypeException(
          `Unsupported or undetectable source format for file "${upload?.filename ?? ''}"`,
        );
      }

      const fileSize = upload.size;
      const started = Date.now();
      try {
        this.assertWithinSizeLimit(source, upload);
        this.assertNotEmpty(upload);
        this.assertSupportedPair(source, target);

        outputPath = await this.storage.createTempPath();
        const outcome = await this.workers.run({
          inputPath: upload.path!,
          outputPath,
          source,
          target,
          maxDepth: Number(this.configService.get('CONVERT_MAX_DEPTH')),
        });
        if (!outcome.ok) {
          throw new CodecError(outcome.code, outcome.message);
        }
        const durationMs = Date.now() - started;

        // Saving is best-effort and never changes the conversion response.
        const saved = input.save
          ? await this.trySave(outputPath, outcome.resultSize)
          : null;

        await this.record(input.userId, source, target, {
          status: TransformationStatus.SUCCESS,
          errorCode: null,
          fileSize,
          durationMs,
          fileId: saved?.fileId ?? null,
          resultSize: saved ? outcome.resultSize : null,
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

        // The result is complete on disk before the first byte is sent, so a
        // failed conversion can never produce a partial download.
        const stream = saved
          ? this.storage.createReadStream(saved.fileId)
          : this.storage.createTempReadStream(outputPath);
        outputPath = undefined; // now owned by the stream / storage
        return {
          stream,
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
    } finally {
      await this.discard(upload);
      if (outputPath) {
        await this.storage.removeTemp(outputPath);
      }
    }
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

  private detectSourceFormat(filename: string): TextFormat | undefined {
    const ext = filename.includes('.') ? filename.split('.').pop()! : '';
    return ext ? formatFromExtension(ext) : undefined;
  }

  private sizeLimit(source: TextFormat): number {
    return Number(this.configService.get(SIZE_LIMIT_CONFIG_KEY[source]));
  }

  private assertNotEmpty(upload: StagedUpload): void {
    if (upload.size === 0) {
      throw new CodecError(ConversionErrorCode.EMPTY_FILE, 'File is empty');
    }
  }

  private assertWithinSizeLimit(
    source: TextFormat,
    upload: StagedUpload,
  ): void {
    if (upload.tooLarge) {
      throw new CodecError(
        ConversionErrorCode.FILE_TOO_LARGE,
        `File exceeds the ${source.toUpperCase()} size limit of ${this.sizeLimit(source)} bytes`,
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
   * Moves the result into storage under a new fileId. Best-effort: returns
   * null (and logs) when the result exceeds the save-size limit or the move
   * fails, so the conversion response is unaffected.
   */
  private async trySave(
    outputPath: string,
    size: number,
  ): Promise<{ fileId: string } | null> {
    const max = Number(this.configService.get('CONVERT_MAX_SAVE_SIZE'));
    if (size > max) {
      this.logger.warn(
        `Result not saved: ${size} bytes exceeds CONVERT_MAX_SAVE_SIZE (${max})`,
      );
      return null;
    }
    const fileId = randomUUID();
    try {
      await this.storage.moveIn(outputPath, fileId);
      return { fileId };
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
}

/** Consumes and discards the rest of a stream. */
async function drain(stream: Readable): Promise<void> {
  if (stream.readableEnded || stream.destroyed) {
    return;
  }
  stream.resume();
  await finished(stream).catch(() => undefined);
}
