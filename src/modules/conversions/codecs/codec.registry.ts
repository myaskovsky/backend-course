import { Injectable } from '@nestjs/common';

import { TextFormat } from '../conversions.constants';
import { CsvCodec } from './csv.codec';
import { FormatCodec } from './format-codec';
import { JsonCodec } from './json.codec';
import { XmlCodec } from './xml.codec';
import { YamlCodec } from './yaml.codec';

/**
 * Resolves a FormatCodec by format. Registering a new format is a one-line
 * addition here plus the new codec class — no other code changes.
 */
@Injectable()
export class CodecRegistry {
  private readonly codecs: Record<TextFormat, FormatCodec>;

  constructor(csv: CsvCodec, json: JsonCodec, xml: XmlCodec, yaml: YamlCodec) {
    this.codecs = {
      [TextFormat.CSV]: csv,
      [TextFormat.JSON]: json,
      [TextFormat.XML]: xml,
      [TextFormat.YAML]: yaml,
    };
  }

  get(format: TextFormat): FormatCodec {
    return this.codecs[format];
  }
}
