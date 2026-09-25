import { ApiProperty } from '@nestjs/swagger';

import {
  TransformationStatus,
  TransformationType,
} from '@/modules/conversions/entities/transformation-history.entity';

/**
 * A single history record as exposed to clients. Deliberately excludes any
 * owner PII (e.g. userId/email) — it carries only the operation's own metadata.
 */
export class TransformationHistoryItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: TransformationType }) type: TransformationType;
  @ApiProperty() sourceFormat: string;
  @ApiProperty() targetFormat: string;
  @ApiProperty({ enum: TransformationStatus }) status: TransformationStatus;
  @ApiProperty({ description: 'Source file size in bytes.' }) fileSize: number;
  @ApiProperty() durationMs: number;
  @ApiProperty({ nullable: true }) errorCode: string | null;
  @ApiProperty({
    description: 'Whether a result file is saved and downloadable.',
  })
  hasFile: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class PaginatedHistoryDto {
  @ApiProperty({ type: TransformationHistoryItemDto, isArray: true })
  items: TransformationHistoryItemDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
