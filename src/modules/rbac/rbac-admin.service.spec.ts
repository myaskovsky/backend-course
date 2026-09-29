import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RbacAdminService } from './rbac-admin.service';
import { RbacService } from './rbac.service';

describe('RbacAdminService', () => {
  let service: RbacAdminService;
  let rolesRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let permsRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let grantsRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  let rbac: jest.Mocked<Pick<RbacService, 'reload'>>;

  beforeEach(() => {
    const mk = () => ({
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((e: unknown) =>
        Promise.resolve({ id: 'new-id', ...(e as object) }),
      ),
      create: jest.fn((e: unknown) => e),
      delete: jest.fn().mockResolvedValue(undefined),
    });
    rolesRepo = mk();
    permsRepo = mk();
    grantsRepo = { ...mk(), count: jest.fn().mockResolvedValue(0) };
    rbac = { reload: jest.fn().mockResolvedValue(undefined) };

    service = new RbacAdminService(
      rolesRepo as unknown as Repository<Role>,
      permsRepo as unknown as Repository<Permission>,
      grantsRepo as unknown as Repository<Grant>,
      rbac as unknown as RbacService,
    );
  });

  describe('roles', () => {
    it('creates a role and reloads the config', async () => {
      rolesRepo.findOne.mockResolvedValue(null);
      await service.createRole({ name: 'editor' });
      expect(rolesRepo.save).toHaveBeenCalled();
      expect(rbac.reload).toHaveBeenCalled();
    });

    it('rejects a duplicate role name with 409', async () => {
      rolesRepo.findOne.mockResolvedValue({ id: 'r1', name: 'editor' });
      await expect(
        service.createRole({ name: 'editor' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404 when updating a missing role', async () => {
      rolesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateRole('missing', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to delete a role that still has grants (409)', async () => {
      rolesRepo.findOne.mockResolvedValue({ id: 'r1', name: 'editor' });
      grantsRepo.count.mockResolvedValue(2);
      await expect(service.deleteRole('r1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(rolesRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes a role with no grants', async () => {
      rolesRepo.findOne.mockResolvedValue({ id: 'r1', name: 'editor' });
      grantsRepo.count.mockResolvedValue(0);
      await service.deleteRole('r1');
      expect(rolesRepo.delete).toHaveBeenCalledWith('r1');
      expect(rbac.reload).toHaveBeenCalled();
    });
  });

  describe('grants', () => {
    it('404 when role or permission is missing', async () => {
      rolesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createGrant({ roleId: 'r1', permissionId: 'p1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects duplicate role+permission grants (409)', async () => {
      rolesRepo.findOne.mockResolvedValue({ id: 'r1' });
      permsRepo.findOne.mockResolvedValue({ id: 'p1' });
      grantsRepo.findOne.mockResolvedValue({ id: 'g1' });
      await expect(
        service.createGrant({ roleId: 'r1', permissionId: 'p1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a grant with null actions when none provided (all actions)', async () => {
      rolesRepo.findOne.mockResolvedValue({ id: 'r1' });
      permsRepo.findOne.mockResolvedValue({ id: 'p1' });
      grantsRepo.findOne.mockResolvedValue(null);
      await service.createGrant({
        roleId: 'r1',
        permissionId: 'p1',
        actions: [],
      });
      const saved = grantsRepo.create.mock.calls[0][0] as {
        actions: string[] | null;
      };
      expect(saved.actions).toBeNull();
      expect(rbac.reload).toHaveBeenCalled();
    });
  });

  describe('permissions', () => {
    it('refuses to delete a permission with grants (409)', async () => {
      permsRepo.findOne.mockResolvedValue({ id: 'p1', name: 'users' });
      grantsRepo.count.mockResolvedValue(1);
      await expect(service.deletePermission('p1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
  describe('roles (more)', () => {
    it('lists roles from the repository', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 'r1' }]);
      await expect(service.listRoles()).resolves.toEqual([{ id: 'r1' }]);
    });

    it('stores a null description when none is provided', async () => {
      rolesRepo.findOne.mockResolvedValue(null);
      await service.createRole({ name: 'editor' });
      expect(rolesRepo.create).toHaveBeenCalledWith({
        name: 'editor',
        description: null,
      });
    });

    it('updates name and description and reloads', async () => {
      rolesRepo.findOne
        .mockResolvedValueOnce({ id: 'r1', name: 'old', description: null })
        .mockResolvedValueOnce(null);
      const saved = await service.updateRole('r1', {
        name: 'new',
        description: 'desc',
      });
      expect(saved).toMatchObject({
        id: 'r1',
        name: 'new',
        description: 'desc',
      });
      expect(rbac.reload).toHaveBeenCalled();
    });

    it('does not check for conflicts when the name is unchanged', async () => {
      rolesRepo.findOne.mockResolvedValueOnce({ id: 'r1', name: 'same' });
      await service.updateRole('r1', { name: 'same' });
      expect(rolesRepo.findOne).toHaveBeenCalledTimes(1);
      expect(rolesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'same' }),
      );
    });

    it('keeps the description when it is not provided', async () => {
      rolesRepo.findOne.mockResolvedValueOnce({
        id: 'r1',
        name: 'n',
        description: 'keep',
      });
      await service.updateRole('r1', {});
      expect(rolesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'keep' }),
      );
    });

    it('rejects renaming a role to an existing name (409)', async () => {
      rolesRepo.findOne
        .mockResolvedValueOnce({ id: 'r1', name: 'old' })
        .mockResolvedValueOnce({ id: 'r2', name: 'taken' });
      await expect(
        service.updateRole('r1', { name: 'taken' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(rolesRepo.save).not.toHaveBeenCalled();
      expect(rbac.reload).not.toHaveBeenCalled();
    });

    it('404 when deleting a missing role', async () => {
      rolesRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteRole('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(rolesRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('permissions (more)', () => {
    it('lists permissions', async () => {
      permsRepo.find.mockResolvedValue([{ id: 'p1' }]);
      await expect(service.listPermissions()).resolves.toEqual([{ id: 'p1' }]);
    });

    it('creates a permission and reloads', async () => {
      permsRepo.findOne.mockResolvedValue(null);
      const created = await service.createPermission({
        name: 'files',
        actions: ['read'],
      });
      expect(permsRepo.create).toHaveBeenCalledWith({
        name: 'files',
        actions: ['read'],
      });
      expect(created.id).toBe('new-id');
      expect(rbac.reload).toHaveBeenCalled();
    });

    it('rejects a duplicate permission name (409)', async () => {
      permsRepo.findOne.mockResolvedValue({ id: 'p1', name: 'files' });
      await expect(
        service.createPermission({ name: 'files', actions: ['read'] }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(permsRepo.save).not.toHaveBeenCalled();
    });

    it('404 when updating a missing permission', async () => {
      permsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updatePermission('missing', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects renaming a permission to an existing name (409)', async () => {
      permsRepo.findOne
        .mockResolvedValueOnce({ id: 'p1', name: 'old' })
        .mockResolvedValueOnce({ id: 'p2', name: 'taken' });
      await expect(
        service.updatePermission('p1', { name: 'taken' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates name and actions and reloads', async () => {
      permsRepo.findOne
        .mockResolvedValueOnce({ id: 'p1', name: 'old', actions: ['read'] })
        .mockResolvedValueOnce(null);
      const saved = await service.updatePermission('p1', {
        name: 'new',
        actions: ['read', 'update'],
      });
      expect(saved).toMatchObject({ name: 'new', actions: ['read', 'update'] });
      expect(rbac.reload).toHaveBeenCalled();
    });

    it('keeps actions when not provided', async () => {
      permsRepo.findOne.mockResolvedValueOnce({
        id: 'p1',
        name: 'n',
        actions: ['read'],
      });
      await service.updatePermission('p1', {});
      expect(permsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'n', actions: ['read'] }),
      );
    });

    it('404 when deleting a missing permission', async () => {
      permsRepo.findOne.mockResolvedValue(null);
      await expect(service.deletePermission('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes a permission with no grants and reloads', async () => {
      permsRepo.findOne.mockResolvedValue({ id: 'p1' });
      grantsRepo.count.mockResolvedValue(0);
      await service.deletePermission('p1');
      expect(grantsRepo.count).toHaveBeenCalledWith({
        where: { permissionId: 'p1' },
      });
      expect(permsRepo.delete).toHaveBeenCalledWith('p1');
      expect(rbac.reload).toHaveBeenCalled();
    });
  });

  describe('grants (more)', () => {
    it('lists grants', async () => {
      grantsRepo.find.mockResolvedValue([{ id: 'g1' }]);
      await expect(service.listGrants()).resolves.toEqual([{ id: 'g1' }]);
    });

    it('404 when the permission is missing', async () => {
      rolesRepo.findOne.mockResolvedValue({ id: 'r1' });
      permsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createGrant({ roleId: 'r1', permissionId: 'p1' }),
      ).rejects.toThrow('Permission not found');
    });

    it('keeps explicit actions on create', async () => {
      rolesRepo.findOne.mockResolvedValue({ id: 'r1' });
      permsRepo.findOne.mockResolvedValue({ id: 'p1' });
      grantsRepo.findOne.mockResolvedValue(null);
      await service.createGrant({
        roleId: 'r1',
        permissionId: 'p1',
        actions: ['read'],
      });
      expect(grantsRepo.create).toHaveBeenCalledWith({
        roleId: 'r1',
        permissionId: 'p1',
        actions: ['read'],
      });
    });

    it('404 when updating a missing grant', async () => {
      grantsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateGrant('missing', { actions: ['read'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates grant actions, normalising empty to null', async () => {
      grantsRepo.findOne.mockResolvedValue({ id: 'g1', actions: ['read'] });
      const saved = await service.updateGrant('g1', { actions: [] });
      expect(saved.actions).toBeNull();
      expect(rbac.reload).toHaveBeenCalled();
    });

    it('updates grant actions to the given list', async () => {
      grantsRepo.findOne.mockResolvedValue({ id: 'g1', actions: null });
      const saved = await service.updateGrant('g1', {
        actions: ['read', 'delete'],
      });
      expect(saved.actions).toEqual(['read', 'delete']);
    });

    it('404 when deleting a missing grant', async () => {
      grantsRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteGrant('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(grantsRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes a grant and reloads', async () => {
      grantsRepo.findOne.mockResolvedValue({ id: 'g1' });
      await service.deleteGrant('g1');
      expect(grantsRepo.delete).toHaveBeenCalledWith('g1');
      expect(rbac.reload).toHaveBeenCalled();
    });
  });
});
