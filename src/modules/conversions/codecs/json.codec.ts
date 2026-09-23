import { Injectable } from '@nestjs/common';

import { ConversionErrorCode, TextFormat } from '../conversions.constants';
import { CodecError } from './codec-error';
import { FormatCodec, Intermediate } from './format-codec';

/** JSON codec (RFC 8259). Uses the platform JSON implementation. */
@Injectable()
export class JsonCodec extends FormatCodec {
  readonly format = TextFormat.JSON;
  readonly contentType = 'application/json; charset=utf-8';
  readonly extension = 'json';

  parse(input: string): Intermediate {
    try {
      return JSON.parse(input);
    } catch (err) {
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        `Invalid JSON: ${(err as Error).message}`,
      );
    }
  }

  serialize(data: Intermediate): string {
    return `${JSON.stringify(data, null, 2)}\n`;
  }
}
