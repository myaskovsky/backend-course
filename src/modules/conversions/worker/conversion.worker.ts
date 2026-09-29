import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

// Relative imports only: this module is the entry point of a worker thread,
// which is loaded by plain Node (no Nest, no `@/` path alias).
import { CodecError } from '../codecs/codec-error';
import { getCodec } from '../codecs/codec.registry';
import { assertWithinDepth } from '../codecs/depth-guard';
import { Utf8DecodeStream } from '../codecs/utf8-decode.stream';
import type { ConversionOutcome, ConversionTask } from './conversion-task';

/**
 * Converts one file inside a worker thread (see ConversionWorkerPool):
 *
 *   disk → strict UTF-8 decoder → streaming parser → IR
 *        → streaming serializer → disk
 *
 * The whole pipeline runs off the main event loop, so a slow or CPU-heavy
 * conversion cannot stall other requests, and the pool can terminate it on
 * timeout.
 */
export default async function convert(
  task: ConversionTask,
): Promise<ConversionOutcome> {
  try {
    const file = createReadStream(task.inputPath);
    const text = file.pipe(new Utf8DecodeStream());
    file.on('error', (err) => text.destroy(err));
    const data = await getCodec(task.source).parse(text, {
      maxDepth: task.maxDepth,
    });
    // Streaming parsers bound depth while reading; this re-check covers every
    // codec with the exact same rule.
    assertWithinDepth(data, task.maxDepth);

    await pipeline(
      getCodec(task.target).serialize(data),
      createWriteStream(task.outputPath),
    );
    const { size } = await stat(task.outputPath);
    return { ok: true, resultSize: size };
  } catch (err) {
    if (err instanceof CodecError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }
}
