import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TextFormat } from '../conversions.constants';

/**
 * Multipart body for POST /api/convert. The request is `multipart/form-data`,
 * so this DTO documents the shape for Swagger; the values are validated
 * manually in the controller/service (multipart bypasses the JSON
 * ValidationPipe).
 */
export class ConvertDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Source file (CSV, JSON, XML, or YAML).',
  })
  file: unknown;

  @ApiProperty({
    enum: TextFormat,
    description: 'Target format to convert the file into.',
  })
  targetFormat: TextFormat;

  @ApiPropertyOptional({
    type: 'boolean',
    default: false,
    description:
      'When true, the result file is saved to storage and becomes downloadable from the transformation history.',
  })
  save?: boolean;
}
