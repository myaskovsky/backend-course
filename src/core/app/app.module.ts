import { Module } from '@nestjs/common';

import { ConfigModule } from '@/core/config/config.module';
import { DatabaseModule } from '@/core/database/database.module';
import { HealthModule } from '@/core/health/health.module';
import { ThrottlerModule } from '@/core/throttler/throttler.module';

/**
 *
 * Application modules
 *
 */
import { AuthModule } from '@/modules/auth/auth.module';
import { ConversionsModule } from '@/modules/conversions/conversions.module';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { TransformationsModule } from '@/modules/transformations/transformations.module';
import { UsersModule } from '@/modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    ThrottlerModule,
    /**
     *
     * Application modules
     *
     */
    UsersModule,
    AuthModule,
    RbacModule,
    ConversionsModule,
    TransformationsModule,
  ],
})
export class AppModule {}
