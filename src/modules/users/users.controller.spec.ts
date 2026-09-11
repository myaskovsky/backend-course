import { ForbiddenException } from '@nestjs/common';

import { RequestUser } from '@/modules/auth/auth.constants';
import { ChallengeService } from '@/modules/auth/challenge.service';
import { ConfigService } from '@/core/config/config.service';
import { RbacService } from '@/modules/rbac/rbac.service';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<
    Pick<
      UsersService,
      'getProfileOrThrow' | 'updateProfile' | 'softDelete' | 'findById'
    >
  >;
  let rbac: jest.Mocked<Pick<RbacService, 'check'>>;
  let challenge: jest.Mocked<
    Pick<ChallengeService, 'issue' | 'verifyAndConsume'>
  >;
  let configValues: Record<string, string>;

  const self: RequestUser = {
    userId: 'self-id',
    email: 'self@example.com',
    roles: ['user'],
  };
  const admin: RequestUser = {
    userId: 'admin-id',
    email: 'admin@example.com',
    roles: ['admin'],
  };
  const otherId = 'other-id';

  beforeEach(() => {
    configValues = { CONFIRM_SELF_DELETE_ENABLED: 'true' };
    usersService = {
      getProfileOrThrow: jest.fn().mockResolvedValue({ id: 'x' }),
      updateProfile: jest.fn().mockResolvedValue({ id: 'x' }),
      softDelete: jest.fn().mockResolvedValue(undefined),
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'self-id', email: 'self@example.com' }),
    };
    rbac = { check: jest.fn().mockReturnValue(false) };
    challenge = {
      issue: jest.fn().mockResolvedValue({ challengeId: 'ch-1' }),
      verifyAndConsume: jest.fn(),
    };
    controller = new UsersController(
      usersService as unknown as UsersService,
      rbac as unknown as RbacService,
      challenge as unknown as ChallengeService,
      { get: (k: string) => configValues[k] } as unknown as ConfigService,
    );
  });

  describe('getById', () => {
    it('allows self to read own profile without permission (full scope)', async () => {
      await controller.getById('self-id', self);
      expect(usersService.getProfileOrThrow).toHaveBeenCalledWith(
        'self-id',
        'self',
      );
    });

    it("blocks reading another user's profile without users@read (IDOR)", async () => {
      await expect(controller.getById(otherId, self)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(usersService.getProfileOrThrow).not.toHaveBeenCalled();
    });

    it('allows reading others with users@read permission (support scope)', async () => {
      rbac.check.mockReturnValue(true);
      await controller.getById(otherId, self);
      expect(usersService.getProfileOrThrow).toHaveBeenCalledWith(
        otherId,
        'support',
      );
    });
  });

  describe('update', () => {
    it('lets self update only displayName/photo', async () => {
      await controller.update('self-id', { displayName: 'New' }, self);
      expect(usersService.updateProfile).toHaveBeenCalledWith(
        'self-id',
        { displayName: 'New' },
        ['displayName', 'photo'],
      );
    });

    it('forbids self from changing email through this endpoint', async () => {
      await expect(
        controller.update('self-id', { email: 'new@example.com' }, self),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(usersService.updateProfile).not.toHaveBeenCalled();
    });

    it('lets admin update any field including email', async () => {
      rbac.check.mockReturnValue(true);
      await controller.update(otherId, { email: 'new@example.com' }, admin);
      expect(usersService.updateProfile).toHaveBeenCalledWith(
        otherId,
        { email: 'new@example.com' },
        ['email', 'displayName', 'photo', 'status'],
      );
    });
  });

  describe('remove', () => {
    it('admin soft-deletes directly', async () => {
      rbac.check.mockReturnValue(true);
      const res = await controller.remove(otherId, admin);
      expect(usersService.softDelete).toHaveBeenCalledWith(otherId);
      expect(res).toEqual({ deleted: true });
    });

    it('self-delete issues an OTP challenge when confirmation is enabled', async () => {
      const res = await controller.remove('self-id', self);
      expect(challenge.issue).toHaveBeenCalled();
      expect(res).toEqual({ requiresConfirmation: true, challengeId: 'ch-1' });
      expect(usersService.softDelete).not.toHaveBeenCalled();
    });

    it('self-delete happens directly when confirmation is disabled', async () => {
      configValues.CONFIRM_SELF_DELETE_ENABLED = 'false';
      const res = await controller.remove('self-id', self);
      expect(usersService.softDelete).toHaveBeenCalledWith('self-id');
      expect(res).toEqual({ deleted: true });
    });

    it('forbids deleting another user without permission', async () => {
      await expect(controller.remove(otherId, self)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('confirmSelfDelete', () => {
    it('soft-deletes after a valid confirmation', async () => {
      challenge.verifyAndConsume.mockResolvedValue({
        userId: 'self-id',
      } as never);
      await controller.confirmSelfDelete(
        'self-id',
        { challengeId: 'ch-1', code: '123456' },
        self,
      );
      expect(usersService.softDelete).toHaveBeenCalledWith('self-id');
    });

    it('forbids confirming deletion for another user', async () => {
      await expect(
        controller.confirmSelfDelete(
          otherId,
          { challengeId: 'ch-1', code: '123456' },
          self,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
