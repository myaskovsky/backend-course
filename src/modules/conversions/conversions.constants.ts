// Type-only: this file is also loaded inside the conversion worker thread,
// which runs outside Nest and without the `@/` path alias.
import type { Config } from '../../core/config/config.types';

/**
 * Supported text formats and their conversion matrix.
 *
 * The feature supports every pairwise direction among the four formats
 * (12 directions total). A source may never convert to itself.
 */
export enum TextFormat {
  CSV = 'csv',
  JSON = 'json',
  XML = 'xml',
  YAML = 'yaml',
}

export const TEXT_FORMATS: readonly TextFormat[] = Object.values(TextFormat);

/** True for any valid source→target pair (all pairs except identity). */
export function isSupportedPair(
  source: TextFormat,
  target: TextFormat,
): boolean {
  return source !== target;
}

/** MIME type returned for a converted file of the given format. */
export const CONTENT_TYPES: Record<TextFormat, string> = {
  [TextFormat.CSV]: 'text/csv; charset=utf-8',
  [TextFormat.JSON]: 'application/json; charset=utf-8',
  [TextFormat.XML]: 'application/xml; charset=utf-8',
  [TextFormat.YAML]: 'application/yaml; charset=utf-8',
};

/** File extension used for the converted download and for source detection. */
export const EXTENSIONS: Record<TextFormat, string> = {
  [TextFormat.CSV]: 'csv',
  [TextFormat.JSON]: 'json',
  [TextFormat.XML]: 'xml',
  [TextFormat.YAML]: 'yaml',
};

/**
 * Maps a lowercased filename extension to a TextFormat. `.yml` is accepted as
 * an alias for YAML. Returns undefined for unknown/unsupported extensions.
 */
const EXTENSION_ALIASES: Record<string, TextFormat> = {
  csv: TextFormat.CSV,
  json: TextFormat.JSON,
  xml: TextFormat.XML,
  yaml: TextFormat.YAML,
  yml: TextFormat.YAML,
};

export function formatFromExtension(ext: string): TextFormat | undefined {
  return EXTENSION_ALIASES[ext.toLowerCase()];
}

/** Config key holding the per-source-format upload size limit. */
export const SIZE_LIMIT_CONFIG_KEY: Record<TextFormat, keyof Config> = {
  [TextFormat.CSV]: 'CONVERT_MAX_SIZE_CSV',
  [TextFormat.JSON]: 'CONVERT_MAX_SIZE_JSON',
  [TextFormat.XML]: 'CONVERT_MAX_SIZE_XML',
  [TextFormat.YAML]: 'CONVERT_MAX_SIZE_YAML',
};

/** Stable machine-readable error codes recorded in transformation history. */
export enum ConversionErrorCode {
  UNSUPPORTED_PAIR = 'unsupported_pair',
  EMPTY_FILE = 'empty_file',
  INVALID_ENCODING = 'invalid_encoding',
  FILE_TOO_LARGE = 'file_too_large',
  INVALID_SYNTAX = 'invalid_syntax',
  DEPTH_EXCEEDED = 'depth_exceeded',
  NOT_TABULAR = 'not_tabular',
  TIMEOUT = 'timeout',
}
