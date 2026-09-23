import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorageModule } from '@/modules/storage/storage.module';

import { CsvCodec } from './codecs/csv.codec';
import { CodecRegistry } from './codecs/codec.registry';
import { JsonCodec } from './codecs/json.codec';
import { XmlCodec } from './codecs/xml.codec';
import { YamlCodec } from './codecs/yaml.codec';
import { ConversionsController } from './conversions.controller';
import { ConversionsService } from './conversions.service';
import { TransformationHistory } from './entities/transformation-history.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TransformationHistory]), StorageModule],
  controllers: [ConversionsController],
  providers: [
    ConversionsService,
    CodecRegistry,
    CsvCodec,
    JsonCodec,
    XmlCodec,
    YamlCodec,
  ],
  exports: [ConversionsService],
})
export class ConversionsModule {}
