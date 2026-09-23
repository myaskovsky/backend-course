import { TextFormat } from '../conversions.constants';

/**
 * Intermediate representation shared by all codecs: a plain JSON-compatible
 * value (object, array, or primitive). Conversion is always
 * `target.serialize(source.parse(input))` over this representation, so adding a
 * new format is one new FormatCodec subclass + a registry entry — no existing
 * codec or controller contract changes. This is the extension point the general
 * transformation requirements call for (e.g. a future image pipeline lives in a
 * sibling module and reuses the same history entity).
 */
export type Intermediate = unknown;

export abstract class FormatCodec {
  /** The format this codec reads and writes. */
  abstract readonly format: TextFormat;
  /** MIME type for the serialized output. */
  abstract readonly contentType: string;
  /** File extension for the serialized output. */
  abstract readonly extension: string;

  /**
   * Parse UTF-8 text into the intermediate representation.
   * @throws CodecError(INVALID_SYNTAX) on malformed input.
   */
  abstract parse(input: string): Intermediate;

  /**
   * Serialize the intermediate representation into this format's text.
   * @throws CodecError(NOT_TABULAR) when the data cannot be expressed (e.g.
   *   non-tabular data targeting CSV).
   */
  abstract serialize(data: Intermediate): string;
}
