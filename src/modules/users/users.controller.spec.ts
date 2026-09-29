import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { RequestUser } from '@/modules/auth/auth.constants';
import { ChallengeService } from '@/modules/auth/challenge.service';
import { ChallengeType } from '@/modules/auth/entities/email-challenge.entity';
import { ConfigService } from '@/core/config/config.service';
import { RbacService } from '@/modules/rbac/rbac.service';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<
    Pick<
      UsersService,
      | 'getProfileOrThrow'
      | 'updateProfile'
      | 'softDelete'
      | 'findById'
      | 'findByEmail'
      | 'changeEmail'
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
      findByEmail: jest.fn().mockResolvedValue(null),
      changeEmail: jest.fn().mockResolvedValue(undefined),
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
  describe('update (more)', () => {
    it('forbids a non-admin from updating another user', async () => {
      await expect(
        controller.update(otherId, { displayName: 'x' }, self),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(rbac.check).toHaveBeenCalledWith(['user'], 'users', 'update');
      expect(usersService.updateProfile).not.toHaveBeenCalled();
    });
  });

  describe('initiateEmailChange', () => {
    it('forbids changing the email of another account', async () => {
      await expect(
        controller.initiateEmailChange(
          otherId,
          { newEmail: 'new@example.com' },
          self,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(challenge.issue).not.toHaveBeenCalled();
    });

    it('rejects an email already in use (409)', async () => {
      usersService.findByEmail.mockResolvedValue({ id: otherId } as never);
      await expect(
        controller.initiateEmailChange(
          'self-id',
          { newEmail: 'taken@example.com' },
          self,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(challenge.issue).not.toHaveBeenCalled();
    });

    it('normalises the new email and issues an EMAIL_CHANGE challenge', async () => {
      const res = await controller.initiateEmailChange(
        'self-id',
        { newEmail: '  New@Example.COM ' },
        self,
      );
      expect(usersService.findByEmail).toHaveBeenCalledWith('new@example.com');
      expect(challenge.issue).toHaveBeenCalledWith({
        type: ChallengeType.EMAIL_CHANGE,
        email: 'new@example.com',
        userId: 'self-id',
      });
      expect(res).toEqual({ requiresConfirmation: true, challengeId: 'ch-1' });
    });
  });

  describe('confirmEmailChange', () => {
    const dto = { challengeId: 'ch-1', code: '123456' };

    it('forbids confirming for another account', async () => {
      await expect(
        controller.confirmEmailChange(otherId, dto, self),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(challenge.verifyAndConsume).not.toHaveBeenCalled();
    });

    it('forbids a challenge issued for a different user', async () => {
      challenge.verifyAndConsume.mockResolvedValue({
        userId: otherId,
        email: 'new@example.com',
      } as never);
      await expect(
        controller.confirmEmailChange('self-id', dto, self),
      ).rejects.toThrow('Confirmation does not belong to this user');
      expect(usersService.changeEmail).not.toHaveBeenCalled();
    });

    it('changes the email to the challenge address on success', async () => {
      challenge.verifyAndConsume.mockResolvedValue({
        userId: 'self-id',
        email: 'new@example.com',
      } as never);
      await expect(
        controller.confirmEmailChange('self-id', dto, self),
      ).resolves.toEqual({ success: true });
      expect(challenge.verifyAndConsume).toHaveBeenCalledWith(
        'ch-1',
        '123456',
        ChallengeType.EMAIL_CHANGE,
      );
      expect(usersService.changeEmail).toHaveBeenCalledWith(
        'self-id',
        'new@example.com',
      );
    });

    it('propagates an invalid OTP error from the challenge service', async () => {
      challenge.verifyAndConsume.mockRejectedValue(new Error('bad code'));
      await expect(
        controller.confirmEmailChange('self-id', dto, self),
      ).rejects.toThrow('bad code');
      expect(usersService.changeEmail).not.toHaveBeenCalled();
    });
  });

  describe('remove (more)', () => {
    it('404 when the self user no longer exists during self-delete', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(controller.remove('self-id', self)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(challenge.issue).not.toHaveBeenCalled();
    });

    it('issues the self-delete challenge to the stored email', async () => {
      await controller.remove('self-id', self);
      expect(challenge.issue).toHaveBeenCalledWith({
        type: ChallengeType.SELF_DELETE,
        email: 'self@example.com',
        userId: 'self-id',
      });
    });
  });

  describe('confirmSelfDelete (more)', () => {
    it('forbids a challenge that belongs to a different user', async () => {
      challenge.verifyAndConsume.mockResolvedValue({
        userId: otherId,
      } as never);
      await expect(
        controller.confirmSelfDelete(
          'self-id',
          { challengeId: 'ch-1', code: '123456' },
          self,
        ),
      ).rejects.toThrow('Confirmation does not belong to this user');
      expect(challenge.verifyAndConsume).toHaveBeenCalledWith(
        'ch-1',
        '123456',
        ChallengeType.SELF_DELETE,
      );
      expect(usersService.softDelete).not.toHaveBeenCalled();
    });
  });
});
