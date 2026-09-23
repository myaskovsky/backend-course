import { Injectable } from '@nestjs/common';
import * as yaml from 'js-yaml';

import { ConversionErrorCode, TextFormat } from '../conversions.constants';
import { CodecError } from './codec-error';
import { FormatCodec, Intermediate } from './format-codec';

/**
 * YAML codec (YAML 1.2). `js-yaml.load` uses the safe default schema (no
 * arbitrary JS object construction), so untrusted input cannot instantiate
 * unexpected types. YAML is a JSON superset, so YAML↔JSON is a direct mapping.
 */
@Injectable()
export class YamlCodec extends FormatCodec {
  readonly format = TextFormat.YAML;
  readonly contentType = 'application/yaml; charset=utf-8';
  readonly extension = 'yaml';

  parse(input: string): Intermediate {
    // js-yaml throws on a whitespace-only document; treat it as an empty value.
    if (input.trim() === '') {
      return null;
    }
    try {
      return yaml.load(input) ?? null;
    } catch (err) {
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        `Invalid YAML: ${(err as Error).message}`,
      );
    }
  }

  serialize(data: Intermediate): string {
    return yaml.dump(data, { noRefs: true, lineWidth: -1 });
  }
}
