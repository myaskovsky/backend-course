import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';

/**
 * In-memory access map: roleName -> resource -> allowed actions.
 * A `null` action set means "all actions allowed" for that resource.
 */
type RoleAccess = Map<string, Set<string> | null>;

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name);
  private accessByRole = new Map<string, RoleAccess>();

  constructor(
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionsRepo: Repository<Permission>,
    @InjectRepository(Grant) private readonly grantsRepo: Repository<Grant>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /**
   * Rebuilds the cached configuration from the database. Called at startup and
   * after any admin change to roles/permissions/grants (dynamic update).
   */
  async reload(): Promise<void> {
    const [roles, permissions, grants] = await Promise.all([
      this.rolesRepo.find(),
      this.permissionsRepo.find(),
      this.grantsRepo.find(),
    ]);

    const roleNameById = new Map(roles.map((r) => [r.id, r.name]));
    const permById = new Map(permissions.map((p) => [p.id, p]));

    const map = new Map<string, RoleAccess>();
    for (const grant of grants) {
      const roleName = roleNameById.get(grant.roleId);
      const permission = permById.get(grant.permissionId);
      if (!roleName || !permission) {
        continue;
      }

      let access = map.get(roleName);
      if (!access) {
        access = new Map();
        map.set(roleName, access);
      }

      // null/empty grant actions => all actions of the permission
      const actions =
        !grant.actions || grant.actions.length === 0
          ? null
          : new Set(grant.actions);
      access.set(permission.name, actions);
    }

    this.accessByRole = map;
    this.logger.log(
      `RBAC config reloaded: ${roles.length} roles, ${permissions.length} permissions, ${grants.length} grants`,
    );
  }

  /**
   * Returns true if any of the given roles grants `action` on `resource`.
   */
  check(roles: string[], resource: string, action: string): boolean {
    for (const role of roles) {
      const access = this.accessByRole.get(role);
      if (!access || !access.has(resource)) {
        continue;
      }
      const actions = access.get(resource);
      if (actions === null || actions === undefined || actions.has(action)) {
        return true;
      }
    }
    return false;
  }
}
