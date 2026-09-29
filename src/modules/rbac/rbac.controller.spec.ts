import { RbacController } from './rbac.controller';
import { RbacAdminService } from './rbac-admin.service';

describe('RbacController', () => {
  let controller: RbacController;
  let admin: jest.Mocked<RbacAdminService>;

  beforeEach(() => {
    admin = {
      listRoles: jest.fn().mockResolvedValue([]),
      createRole: jest.fn().mockResolvedValue({}),
      updateRole: jest.fn().mockResolvedValue({}),
      deleteRole: jest.fn().mockResolvedValue(undefined),
      listPermissions: jest.fn().mockResolvedValue([]),
      createPermission: jest.fn().mockResolvedValue({}),
      updatePermission: jest.fn().mockResolvedValue({}),
      deletePermission: jest.fn().mockResolvedValue(undefined),
      listGrants: jest.fn().mockResolvedValue([]),
      createGrant: jest.fn().mockResolvedValue({}),
      updateGrant: jest.fn().mockResolvedValue({}),
      deleteGrant: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RbacAdminService>;
    controller = new RbacController(admin);
  });

  it('delegates role operations to the admin service', async () => {
    await controller.listRoles();
    await controller.createRole({ name: 'editor' });
    await controller.updateRole('r1', { name: 'x' });
    await controller.deleteRole('r1');
    expect(admin.listRoles).toHaveBeenCalled();
    expect(admin.createRole).toHaveBeenCalledWith({ name: 'editor' });
    expect(admin.updateRole).toHaveBeenCalledWith('r1', { name: 'x' });
    expect(admin.deleteRole).toHaveBeenCalledWith('r1');
  });

  it('delegates permission and grant operations', async () => {
    await controller.listPermissions();
    await controller.createPermission({ name: 'users', actions: ['read'] });
    await controller.deletePermission('p1');
    await controller.listGrants();
    await controller.createGrant({ roleId: 'r1', permissionId: 'p1' });
    await controller.deleteGrant('g1');
    expect(admin.createPermission).toHaveBeenCalled();
    expect(admin.createGrant).toHaveBeenCalledWith({
      roleId: 'r1',
      permissionId: 'p1',
    });
    expect(admin.deleteGrant).toHaveBeenCalledWith('g1');
  });
  it('delegates permission and grant updates with id and dto', async () => {
    await controller.updatePermission('p1', { actions: ['read'] });
    await controller.updateGrant('g1', { actions: ['update'] });
    expect(admin.updatePermission).toHaveBeenCalledWith('p1', {
      actions: ['read'],
    });
    expect(admin.updateGrant).toHaveBeenCalledWith('g1', {
      actions: ['update'],
    });
  });

  it('returns what the admin service resolves', async () => {
    admin.listRoles.mockResolvedValue([{ id: 'r1' }] as never);
    admin.listPermissions.mockResolvedValue([{ id: 'p1' }] as never);
    admin.listGrants.mockResolvedValue([{ id: 'g1' }] as never);
    await expect(controller.listRoles()).resolves.toEqual([{ id: 'r1' }]);
    await expect(controller.listPermissions()).resolves.toEqual([{ id: 'p1' }]);
    await expect(controller.listGrants()).resolves.toEqual([{ id: 'g1' }]);
    expect(admin.listPermissions).toHaveBeenCalled();
    expect(admin.listGrants).toHaveBeenCalled();
  });

  it('propagates service errors', async () => {
    admin.deletePermission.mockRejectedValue(new Error('conflict'));
    await expect(controller.deletePermission('p1')).rejects.toThrow('conflict');
    expect(admin.deletePermission).toHaveBeenCalledWith('p1');
  });
});
