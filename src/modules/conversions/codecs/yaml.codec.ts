import { Readable } from 'node:stream';

import * as yaml from 'js-yaml';

import { ConversionErrorCode, TextFormat } from '../conversions.constants';
import { CodecError } from './codec-error';
import { assertWithinDepth } from './depth-guard';
import {
  batched,
  FormatCodec,
  Intermediate,
  ParseOptions,
} from './format-codec';

/**
 * YAML codec (YAML 1.2). `js-yaml.load` uses the safe default schema (no
 * arbitrary JS object construction), so untrusted input cannot instantiate
 * unexpected types. YAML is a JSON superset, so YAML↔JSON is a direct mapping.
 *
 * Streaming: a YAML document can only be interpreted as a whole (anchors,
 * indentation-defined structure), and js-yaml has no incremental parser. The
 * text is therefore read chunk by chunk (size-bounded by the upload limit and
 * decoded incrementally) and parsed once. Output is streamed per top-level
 * entry.
 */
export class YamlCodec extends FormatCodec {
  readonly format = TextFormat.YAML;

  async parse(
    input: AsyncIterable<string>,
    { maxDepth }: ParseOptions,
  ): Promise<Intermediate> {
    const parts: string[] = [];
    for await (const chunk of input) {
      parts.push(chunk);
    }
    const text = parts.join('');

    // js-yaml throws on a whitespace-only document; treat it as an empty value.
    if (text.trim() === '') {
      return null;
    }
    let data: Intermediate;
    try {
      data = yaml.load(text) ?? null;
    } catch (err) {
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        `Invalid YAML: ${(err as Error).message}`,
      );
    }
    assertWithinDepth(data, maxDepth);
    return data;
  }

  /**
   * A non-empty sequence/mapping is dumped one top-level entry at a time.
   * With `noRefs` there are no anchors spanning entries, so the concatenation
   * is exactly what dumping the whole value at once would produce.
   */
  serialize(data: Intermediate): Readable {
    const options: yaml.DumpOptions = { noRefs: true, lineWidth: -1 };
    function* chunks(): Generator<string> {
      if (Array.isArray(data) && data.length > 0) {
        for (const item of data) {
          yield yaml.dump([item], options);
        }
      } else if (isPlainObject(data) && Object.keys(data).length > 0) {
        for (const [key, value] of Object.entries(data)) {
          yield yaml.dump({ [key]: value }, options);
        }
      } else {
        yield yaml.dump(data, options);
      }
    }
    return batched(chunks());
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}
