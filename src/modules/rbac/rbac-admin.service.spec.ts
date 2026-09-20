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
});
