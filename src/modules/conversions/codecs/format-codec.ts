import { Readable } from 'node:stream';

import { TextFormat } from '../conversions.constants';

/**
 * Intermediate representation shared by all codecs: a plain JSON-compatible
 * value (object, array, or primitive). Conversion is always
 * `target.serialize(await source.parse(input))` over this representation, so
 * adding a new format is one new FormatCodec subclass + a registry entry.
 */
export type Intermediate = unknown;

export interface ParseOptions {
  /** Max nesting depth; parsing aborts with DEPTH_EXCEEDED as soon as it is hit. */
  maxDepth: number;
}

/**
 * A format codec works on streams: `parse` consumes decoded UTF-8 text chunk by
 * chunk (never the whole file as one string, except where the format itself
 * requires it — see YamlCodec), and `serialize` produces the output lazily so
 * it can be piped straight to disk.
 *
 * Codecs are plain classes (no Nest DI): they run inside the conversion worker
 * thread.
 */
export abstract class FormatCodec {
  /** The format this codec reads and writes. */
  abstract readonly format: TextFormat;

  /**
   * Parse a stream of text chunks into the intermediate representation.
   * @throws CodecError(INVALID_SYNTAX | DEPTH_EXCEEDED)
   */
  abstract parse(
    input: AsyncIterable<string>,
    options: ParseOptions,
  ): Promise<Intermediate>;

  /**
   * Serialize the intermediate representation as a stream of text chunks.
   * @throws CodecError(NOT_TABULAR) when the data cannot be expressed (e.g.
   *   non-tabular data targeting CSV) — thrown synchronously, before any
   *   output is produced.
   */
  abstract serialize(data: Intermediate): Readable;
}

/** Emits generated strings in ~64 KiB batches instead of one tiny chunk each. */
export function batched(chunks: Iterable<string>, size = 64 * 1024): Readable {
  function* batch(): Generator<string> {
    let buffer = '';
    for (const chunk of chunks) {
      buffer += chunk;
      if (buffer.length >= size) {
        yield buffer;
        buffer = '';
      }
    }
    if (buffer) {
      yield buffer;
    }
  }
  return Readable.from(batch(), { objectMode: false, encoding: 'utf8' });
}
