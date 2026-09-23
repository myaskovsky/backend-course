import { ApiProperty } from '@nestjs/swagger';

import { TextFormat } from '../conversions.constants';

/** One source format and every target it can be converted into. */
export class FormatPairDto {
  @ApiProperty({ enum: TextFormat, description: 'Source format.' })
  source: TextFormat;

  @ApiProperty({
    enum: TextFormat,
    isArray: true,
    description: 'Formats the source can be converted into.',
  })
  target: TextFormat[];
}
