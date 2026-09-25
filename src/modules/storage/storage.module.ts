import { Module } from '@nestjs/common';

import { FileStorage } from './file-storage';
import { LocalDiskStorage } from './local-disk.storage';

/**
 * Binds the FileStorage abstraction to the local-disk backend. Swap the
 * `useClass` here to change storage backends without touching consumers.
 */
@Module({
  providers: [{ provide: FileStorage, useClass: LocalDiskStorage }],
  exports: [FileStorage],
})
export class StorageModule {}
