import { ConversionErrorCode } from '../conversions.constants';

/**
 * Domain error thrown by codecs (parse/serialize) and structural guards. The
 * service catches it, records the `code` in transformation history, and maps it
 * to the appropriate HTTP status. Messages are safe to return to the client and
 * MUST NOT contain file contents.
 */
export class CodecError extends Error {
  constructor(
    readonly code: ConversionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CodecError';
  }
}
