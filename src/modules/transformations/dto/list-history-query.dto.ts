import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  TransformationStatus,
  TransformationType,
} from '@/modules/conversions/entities/transformation-history.entity';

/**
 * Query for the transformation-history endpoints (self and admin). Cursor
 * pagination is keyed on (createdAt, id) descending.
 */
export class ListHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor for keyset pagination.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Page size.',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ enum: TransformationType })
  @IsOptional()
  @IsEnum(TransformationType)
  type?: TransformationType;

  @ApiPropertyOptional({ description: 'Source format filter, e.g. csv.' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  sourceFormat?: string;

  @ApiPropertyOptional({ description: 'Target format filter, e.g. json.' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  targetFormat?: string;

  @ApiPropertyOptional({ enum: TransformationStatus })
  @IsOptional()
  @IsEnum(TransformationStatus)
  status?: TransformationStatus;

  @ApiPropertyOptional({
    description: 'Start of the createdAt range (ISO 8601).',
  })
  @IsOptional()
  @IsISO8601()
  createdAtFrom?: string;

  @ApiPropertyOptional({
    description: 'End of the createdAt range (ISO 8601).',
  })
  @IsOptional()
  @IsISO8601()
  createdAtTo?: string;
}
