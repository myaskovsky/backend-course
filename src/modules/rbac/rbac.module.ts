import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RbacController } from './rbac.controller';
import { RbacAdminService } from './rbac-admin.service';
import { RbacService } from './rbac.service';
import { RbacGuard } from './guards/rbac.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission, Grant])],
  controllers: [RbacController],
  providers: [RbacService, RbacAdminService, RbacGuard],
  exports: [RbacService, RbacGuard],
})
export class RbacModule {}
