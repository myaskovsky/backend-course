import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  CreateGrantDto,
  CreatePermissionDto,
  CreateRoleDto,
  UpdateGrantDto,
  UpdatePermissionDto,
  UpdateRoleDto,
} from './dto/rbac.dto';
import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RbacService } from './rbac.service';

/**
 * Admin-only CRUD over RBAC config. Every mutation triggers RbacService.reload()
 * so changes apply without an application restart.
 */
@Injectable()
export class RbacAdminService {
  private readonly logger = new Logger(RbacAdminService.name);

  constructor(
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionsRepo: Repository<Permission>,
    @InjectRepository(Grant) private readonly grantsRepo: Repository<Grant>,
    private readonly rbacService: RbacService,
  ) {}

  // ---- Roles ----
  listRoles(): Promise<Role[]> {
    return this.rolesRepo.find();
  }

  async createRole(dto: CreateRoleDto): Promise<Role> {
    if (await this.rolesRepo.findOne({ where: { name: dto.name } })) {
      throw new ConflictException('Role name already exists');
    }
    const role = await this.rolesRepo.save(
      this.rolesRepo.create({
        name: dto.name,
        description: dto.description ?? null,
      }),
    );
    await this.afterChange('create', 'role', role.id);
    return role;
  }

  async updateRole(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.rolesRepo.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (dto.name && dto.name !== role.name) {
      if (await this.rolesRepo.findOne({ where: { name: dto.name } })) {
        throw new ConflictException('Role name already exists');
      }
      role.name = dto.name;
    }
    if (dto.description !== undefined) {
      role.description = dto.description;
    }
    const saved = await this.rolesRepo.save(role);
    await this.afterChange('update', 'role', id);
    return saved;
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.rolesRepo.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (await this.grantsRepo.count({ where: { roleId: id } })) {
      throw new ConflictException('Cannot delete a role with active grants');
    }
    await this.rolesRepo.delete(id);
    await this.afterChange('delete', 'role', id);
  }

  // ---- Permissions ----
  listPermissions(): Promise<Permission[]> {
    return this.permissionsRepo.find();
  }

  async createPermission(dto: CreatePermissionDto): Promise<Permission> {
    if (await this.permissionsRepo.findOne({ where: { name: dto.name } })) {
      throw new ConflictException('Permission name already exists');
    }
    const permission = await this.permissionsRepo.save(
      this.permissionsRepo.create({ name: dto.name, actions: dto.actions }),
    );
    await this.afterChange('create', 'permission', permission.id);
    return permission;
  }

  async updatePermission(
    id: string,
    dto: UpdatePermissionDto,
  ): Promise<Permission> {
    const permission = await this.permissionsRepo.findOne({ where: { id } });
    if (!permission) {
      throw new NotFoundException('Permission not found');
    }
    if (dto.name && dto.name !== permission.name) {
      if (await this.permissionsRepo.findOne({ where: { name: dto.name } })) {
        throw new ConflictException('Permission name already exists');
      }
      permission.name = dto.name;
    }
    if (dto.actions !== undefined) {
      permission.actions = dto.actions;
    }
    const saved = await this.permissionsRepo.save(permission);
    await this.afterChange('update', 'permission', id);
    return saved;
  }

  async deletePermission(id: string): Promise<void> {
    const permission = await this.permissionsRepo.findOne({ where: { id } });
    if (!permission) {
      throw new NotFoundException('Permission not found');
    }
    if (await this.grantsRepo.count({ where: { permissionId: id } })) {
      throw new ConflictException(
        'Cannot delete a permission with active grants',
      );
    }
    await this.permissionsRepo.delete(id);
    await this.afterChange('delete', 'permission', id);
  }

  // ---- Grants ----
  listGrants(): Promise<Grant[]> {
    return this.grantsRepo.find();
  }

  async createGrant(dto: CreateGrantDto): Promise<Grant> {
    const role = await this.rolesRepo.findOne({ where: { id: dto.roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    const permission = await this.permissionsRepo.findOne({
      where: { id: dto.permissionId },
    });
    if (!permission) {
      throw new NotFoundException('Permission not found');
    }
    const duplicate = await this.grantsRepo.findOne({
      where: { roleId: dto.roleId, permissionId: dto.permissionId },
    });
    if (duplicate) {
      throw new ConflictException(
        'Grant for this role and permission already exists',
      );
    }
    const grant = await this.grantsRepo.save(
      this.grantsRepo.create({
        roleId: dto.roleId,
        permissionId: dto.permissionId,
        actions: dto.actions && dto.actions.length ? dto.actions : null,
      }),
    );
    await this.afterChange('create', 'grant', grant.id);
    return grant;
  }

  async updateGrant(id: string, dto: UpdateGrantDto): Promise<Grant> {
    const grant = await this.grantsRepo.findOne({ where: { id } });
    if (!grant) {
      throw new NotFoundException('Grant not found');
    }
    grant.actions = dto.actions && dto.actions.length ? dto.actions : null;
    const saved = await this.grantsRepo.save(grant);
    await this.afterChange('update', 'grant', id);
    return saved;
  }

  async deleteGrant(id: string): Promise<void> {
    const grant = await this.grantsRepo.findOne({ where: { id } });
    if (!grant) {
      throw new NotFoundException('Grant not found');
    }
    await this.grantsRepo.delete(id);
    await this.afterChange('delete', 'grant', id);
  }

  private async afterChange(
    op: 'create' | 'update' | 'delete',
    entity: 'role' | 'permission' | 'grant',
    id: string,
  ): Promise<void> {
    this.logger.log(`RBAC ${op} ${entity} ${id}`);
    await this.rbacService.reload();
  }
}
