import { Readable } from 'node:stream';

/** A file written to the temporary area, e.g. an upload being converted. */
export interface TempFile {
  path: string;
  size: number;
}

/** Thrown by `writeTemp` when the stream exceeds the given byte limit. */
export class StorageLimitExceededError extends Error {
  constructor(readonly limit: number) {
    super(`Stream exceeds the limit of ${limit} bytes`);
    this.name = 'StorageLimitExceededError';
  }
}

/**
 * Storage abstraction for saved result files and conversion scratch files. The
 * rest of the app depends only on this contract, so the backend (local disk
 * today) can be swapped by binding a different implementation in StorageModule.
 * Saved files are addressed by an opaque, server-generated `fileId`; direct
 * paths are never exposed to clients.
 */
export abstract class FileStorage {
  /** Open a readable stream for `fileId`. Throws if it does not exist. */
  abstract createReadStream(fileId: string): Readable;
  /** True if a file for `fileId` exists. */
  abstract exists(fileId: string): Promise<boolean>;
  /** Delete `fileId`; a no-op if it is already gone. */
  abstract remove(fileId: string): Promise<void>;

  /** A fresh, unused path in the temporary area (nothing is created yet). */
  abstract createTempPath(): Promise<string>;
  /**
   * Streams `source` into a new temp file without buffering it in memory.
   * @throws StorageLimitExceededError as soon as more than `maxBytes` arrive
   *   (the partial file is deleted).
   */
  abstract writeTemp(source: Readable, maxBytes: number): Promise<TempFile>;
  /** Moves a temp file into permanent storage under `fileId`. */
  abstract moveIn(tempPath: string, fileId: string): Promise<void>;
  /** Streams a temp file and deletes it once the stream is closed. */
  abstract createTempReadStream(tempPath: string): Readable;
  /** Deletes a temp file; a no-op if it is already gone. */
  abstract removeTemp(tempPath: string): Promise<void>;
}
