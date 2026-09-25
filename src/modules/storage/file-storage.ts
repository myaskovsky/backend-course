import { Readable } from 'node:stream';

/**
 * Storage abstraction for saved result files. The rest of the app depends only
 * on this contract, so the backend (local disk today; S3/Firebase later) can be
 * swapped by binding a different implementation in StorageModule — no business
 * logic changes. Files are addressed by an opaque, server-generated `fileId`;
 * direct paths are never exposed to clients.
 */
export abstract class FileStorage {
  /** Persist `data` under `fileId`. */
  abstract save(fileId: string, data: Buffer): Promise<void>;
  /** Open a readable stream for `fileId`. Throws if it does not exist. */
  abstract createReadStream(fileId: string): Readable;
  /** True if a file for `fileId` exists. */
  abstract exists(fileId: string): Promise<boolean>;
  /** Delete `fileId`; a no-op if it is already gone. */
  abstract remove(fileId: string): Promise<void>;
}
