import { Readable } from 'node:stream';

import {
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import {
  CONTENT_TYPES,
  EXTENSIONS,
  TextFormat,
} from '@/modules/conversions/conversions.constants';
import { TransformationHistory } from '@/modules/conversions/entities/transformation-history.entity';
import { FileStorage } from '@/modules/storage/file-storage';

import {
  PaginatedHistoryDto,
  TransformationHistoryItemDto,
} from './dto/history-item.dto';
import { ListHistoryQueryDto } from './dto/list-history-query.dto';

export interface DownloadResult {
  stream: Readable;
  contentType: string;
  filename: string;
}

@Injectable()
export class TransformationsService {
  private readonly logger = new Logger(TransformationsService.name);

  constructor(
    @InjectRepository(TransformationHistory)
    private readonly historyRepo: Repository<TransformationHistory>,
    private readonly storage: FileStorage,
  ) {}

  /** Paginated history for a single owner, with optional filters. */
  async listHistory(
    userId: string,
    query: ListHistoryQueryDto,
  ): Promise<PaginatedHistoryDto> {
    const qb = this.historyRepo
      .createQueryBuilder('h')
      .where('h.userId = :userId', { userId })
      .orderBy('h.createdAt', 'DESC')
      .addOrderBy('h.id', 'DESC')
      .limit(query.limit + 1);

    if (query.type) {
      qb.andWhere('h.type = :type', { type: query.type });
    }
    if (query.status) {
      qb.andWhere('h.status = :status', { status: query.status });
    }
    if (query.sourceFormat) {
      qb.andWhere('h.sourceFormat = :sourceFormat', {
        sourceFormat: query.sourceFormat,
      });
    }
    if (query.targetFormat) {
      qb.andWhere('h.targetFormat = :targetFormat', {
        targetFormat: query.targetFormat,
      });
    }
    if (query.createdAtFrom) {
      qb.andWhere('h.createdAt >= :from', { from: query.createdAtFrom });
    }
    if (query.createdAtTo) {
      qb.andWhere('h.createdAt <= :to', { to: query.createdAtTo });
    }
    if (query.cursor) {
      const decoded = this.decodeCursor(query.cursor);
      if (decoded) {
        qb.andWhere('(h.createdAt, h.id) < (:cursorCreatedAt, :cursorId)', {
          cursorCreatedAt: decoded.createdAt,
          cursorId: decoded.id,
        });
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    const nextCursor = hasMore
      ? this.encodeCursor(items[items.length - 1])
      : null;

    return { items: items.map((r) => this.toItem(r)), nextCursor };
  }

  /** Self download: 404 if missing, 403 if owned by someone else. */
  async getOwnDownload(
    actorUserId: string,
    itemId: string,
  ): Promise<DownloadResult> {
    const record = await this.historyRepo.findOne({ where: { id: itemId } });
    if (!record) {
      throw new NotFoundException('History item not found');
    }
    if (record.userId !== actorUserId) {
      throw new ForbiddenException('History item does not belong to you');
    }
    return this.streamFile(record);
  }

  /** Admin download: scoped to the target user; 404 if not found for them. */
  async getUserDownload(
    targetUserId: string,
    itemId: string,
  ): Promise<DownloadResult> {
    const record = await this.historyRepo.findOne({
      where: { id: itemId, userId: targetUserId },
    });
    if (!record) {
      throw new NotFoundException('History item not found');
    }
    return this.streamFile(record);
  }

  /**
   * Deletes every expired record and its saved file. Files are removed first so
   * a crash cannot orphan a row without its file; a leftover file (row already
   * gone) is reaped on a later run. Returns the number of records removed.
   */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const expired = await this.historyRepo.find({
      where: { expiresAt: LessThanOrEqual(now) },
      select: { id: true, fileId: true },
    });
    if (expired.length === 0) {
      return 0;
    }
    for (const record of expired) {
      if (record.fileId) {
        await this.storage.remove(record.fileId);
      }
    }
    await this.historyRepo.delete(expired.map((r) => r.id));
    return expired.length;
  }

  // ---- shared helpers ----

  private async streamFile(
    record: TransformationHistory,
  ): Promise<DownloadResult> {
    if (!record.fileId) {
      throw new NotFoundException('No saved file for this history item');
    }
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('Saved file has expired');
    }
    if (!(await this.storage.exists(record.fileId))) {
      throw new NotFoundException('Saved file is no longer available');
    }

    const target = record.targetFormat as TextFormat;
    const ext = EXTENSIONS[target] ?? 'dat';
    const contentType = CONTENT_TYPES[target] ?? 'application/octet-stream';
    return {
      stream: this.storage.createReadStream(record.fileId),
      contentType,
      filename: `converted.${ext}`,
    };
  }

  private toItem(r: TransformationHistory): TransformationHistoryItemDto {
    return {
      id: r.id,
      type: r.type,
      sourceFormat: r.sourceFormat,
      targetFormat: r.targetFormat,
      status: r.status,
      fileSize: r.fileSize,
      durationMs: r.durationMs,
      errorCode: r.errorCode,
      hasFile:
        r.fileId !== null &&
        (!r.expiresAt || r.expiresAt.getTime() > Date.now()),
      createdAt: r.createdAt,
    };
  }

  private encodeCursor(r: TransformationHistory): string {
    const payload = JSON.stringify({
      createdAt: r.createdAt.toISOString(),
      id: r.id,
    });
    return Buffer.from(payload, 'utf8').toString('base64url');
  }

  private decodeCursor(
    cursor: string,
  ): { createdAt: string; id: string } | null {
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as { createdAt?: unknown; id?: unknown };
      if (
        typeof parsed.createdAt === 'string' &&
        typeof parsed.id === 'string'
      ) {
        return { createdAt: parsed.createdAt, id: parsed.id };
      }
      return null;
    } catch {
      return null;
    }
  }
}
