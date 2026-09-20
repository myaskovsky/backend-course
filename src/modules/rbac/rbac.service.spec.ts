import { Repository } from 'typeorm';

import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RbacService } from './rbac.service';

describe('RbacService', () => {
  const roles: Role[] = [
    { id: 'r-admin', name: 'admin', description: null },
    { id: 'r-editor', name: 'editor', description: null },
  ];
  const permissions: Permission[] = [
    {
      id: 'p-users',
      name: 'users',
      actions: ['create', 'read', 'update', 'delete', 'list'],
    },
    {
      id: 'p-rbac',
      name: 'rbac',
      actions: ['read', 'create', 'update', 'delete'],
    },
  ];
  const grants: Grant[] = [
    // admin: all actions on users (null actions)
    {
      id: 'g1',
      roleId: 'r-admin',
      permissionId: 'p-users',
      actions: null,
    } as Grant,
    // editor: only read/update on users
    {
      id: 'g2',
      roleId: 'r-editor',
      permissionId: 'p-users',
      actions: ['read', 'update'],
    } as Grant,
  ];

  const buildService = () => {
    const rolesRepo = {
      find: jest.fn().mockResolvedValue(roles),
    } as unknown as Repository<Role>;
    const permsRepo = {
      find: jest.fn().mockResolvedValue(permissions),
    } as unknown as Repository<Permission>;
    const grantsRepo = {
      find: jest.fn().mockResolvedValue(grants),
    } as unknown as Repository<Grant>;
    return new RbacService(rolesRepo, permsRepo, grantsRepo);
  };

  let service: RbacService;
  beforeEach(async () => {
    service = buildService();
    await service.reload();
  });

  it('allows all actions when a grant has null actions', () => {
    expect(service.check(['admin'], 'users', 'delete')).toBe(true);
    expect(service.check(['admin'], 'users', 'list')).toBe(true);
  });

  it('allows only listed actions when a grant specifies actions', () => {
    expect(service.check(['editor'], 'users', 'read')).toBe(true);
    expect(service.check(['editor'], 'users', 'update')).toBe(true);
    expect(service.check(['editor'], 'users', 'delete')).toBe(false);
  });

  it('denies resources the role has no grant for', () => {
    expect(service.check(['editor'], 'rbac', 'read')).toBe(false);
  });

  it('denies unknown roles and empty role lists', () => {
    expect(service.check(['ghost'], 'users', 'read')).toBe(false);
    expect(service.check([], 'users', 'read')).toBe(false);
  });

  it('grants access if any of the user roles allows it', () => {
    expect(service.check(['editor', 'admin'], 'users', 'delete')).toBe(true);
  });
});
