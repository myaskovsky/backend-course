import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TransformationHistory } from '@/modules/conversions/entities/transformation-history.entity';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { StorageModule } from '@/modules/storage/storage.module';
import { UsersModule } from '@/modules/users/users.module';

import { AdminTransformationsController } from './admin-transformations.controller';
import { TransformationCleanupService } from './transformation-cleanup.service';
import { TransformationsController } from './transformations.controller';
import { TransformationsService } from './transformations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransformationHistory]),
    StorageModule,
    RbacModule,
    UsersModule,
  ],
  controllers: [TransformationsController, AdminTransformationsController],
  providers: [TransformationsService, TransformationCleanupService],
  exports: [TransformationsService],
})
export class TransformationsModule {}
