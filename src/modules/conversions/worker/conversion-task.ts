import type { ConversionErrorCode, TextFormat } from '../conversions.constants';

/** Message sent to a conversion worker thread (structured-clone friendly). */
export interface ConversionTask {
  /** Uploaded source file (already size-checked). */
  inputPath: string;
  /** Where the converted result is written. */
  outputPath: string;
  source: TextFormat;
  target: TextFormat;
  maxDepth: number;
}

/**
 * Worker reply. Domain errors are returned as data rather than thrown:
 * class identity (CodecError) does not survive the thread boundary.
 */
export type ConversionOutcome =
  | { ok: true; resultSize: number }
  | { ok: false; code: ConversionErrorCode; message: string };
