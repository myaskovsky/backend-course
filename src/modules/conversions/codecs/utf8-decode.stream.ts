import { Transform, TransformCallback } from 'node:stream';

import { ConversionErrorCode } from '../conversions.constants';
import { CodecError } from './codec-error';

/**
 * Buffer → string transform that decodes strict UTF-8 incrementally. A
 * multi-byte character split across chunk boundaries is reassembled, a leading
 * BOM is dropped, and any invalid byte sequence fails the stream with
 * INVALID_ENCODING instead of being silently replaced with U+FFFD.
 */
export class Utf8DecodeStream extends Transform {
  private readonly decoder = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: false,
  });

  constructor() {
    super({ readableObjectMode: false, decodeStrings: true, encoding: 'utf8' });
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
    try {
      const text = this.decoder.decode(chunk, { stream: true });
      done(null, text || undefined);
    } catch {
      done(this.encodingError());
    }
  }

  _flush(done: TransformCallback) {
    try {
      const text = this.decoder.decode();
      done(null, text || undefined);
    } catch {
      done(this.encodingError());
    }
  }

  private encodingError(): CodecError {
    return new CodecError(
      ConversionErrorCode.INVALID_ENCODING,
      'File is not valid UTF-8',
    );
  }
}
