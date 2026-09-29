import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorageModule } from '@/modules/storage/storage.module';

import { ConversionWorkerPool } from './conversion-worker.pool';
import { ConversionsController } from './conversions.controller';
import { ConversionsService } from './conversions.service';
import { TransformationHistory } from './entities/transformation-history.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TransformationHistory]), StorageModule],
  controllers: [ConversionsController],
  providers: [ConversionsService, ConversionWorkerPool],
  exports: [ConversionsService],
})
export class ConversionsModule {}
