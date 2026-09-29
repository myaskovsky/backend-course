import { TextFormat } from '../conversions.constants';
import { CsvCodec } from './csv.codec';
import { FormatCodec } from './format-codec';
import { JsonCodec } from './json.codec';
import { XmlCodec } from './xml.codec';
import { YamlCodec } from './yaml.codec';

/**
 * Resolves a FormatCodec by format. Registering a new format is a one-line
 * addition here plus the new codec class. Codecs are stateless, so one
 * instance per format is shared (per worker thread).
 */
const CODECS: Record<TextFormat, FormatCodec> = {
  [TextFormat.CSV]: new CsvCodec(),
  [TextFormat.JSON]: new JsonCodec(),
  [TextFormat.XML]: new XmlCodec(),
  [TextFormat.YAML]: new YamlCodec(),
};

export function getCodec(format: TextFormat): FormatCodec {
  return CODECS[format];
}
