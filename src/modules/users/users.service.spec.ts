import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import {
  ListUsersQueryDto,
  SortOrder,
  UserSortField,
} from './dto/list-users-query.dto';
import { User, UserStatus } from './entities/user.entity';
import { UsersService } from './users.service';

jest.mock('typeorm-transactional', () => ({
  Transactional: () => () => undefined,
}));

describe('UsersService', () => {
  let service: UsersService;
  let repo: {
    findOne: jest.Mock;
    findByEmail?: jest.Mock;
    save: jest.Mock<Promise<User>, [User]>;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: 'hash',
      status: UserStatus.ACTIVE,
      photo: 'http://img/1.png',
      displayName: 'User One',
      lastLoginAt: null,
      deletedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as User;

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      save: jest.fn((u: User) => Promise.resolve(u)),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
    };
    service = new UsersService(repo as unknown as Repository<User>);
  });

  describe('updateProfile', () => {
    it('applies only allowed fields (default-deny)', async () => {
      repo.findOne.mockResolvedValue(buildUser());

      await service.updateProfile(
        'user-1',
        { displayName: 'Renamed', status: UserStatus.BLOCKED },
        ['displayName', 'photo'],
      );

      const saved = repo.save.mock.calls[0][0];
      expect(saved.displayName).toBe('Renamed');
      // status was NOT in allowedFields, so it must remain unchanged
      expect(saved.status).toBe(UserStatus.ACTIVE);
    });

    it('throws 404 for a missing user', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.updateProfile('missing', { displayName: 'x' }, ['displayName']),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('anonymizes PII and marks the user deleted', async () => {
      repo.findOne.mockResolvedValue(buildUser());

      await service.softDelete('user-1');

      const saved = repo.save.mock.calls[0][0];
      expect(saved.status).toBe(UserStatus.DELETED);
      expect(saved.deletedAt).toBeInstanceOf(Date);
      expect(saved.email).toContain('deleted+user-1@');
      expect(saved.displayName).toBeNull();
      expect(saved.photo).toBeNull();
      expect(saved.passwordHash).toBe('deleted:user-1');
    });

    it('is idempotent for an already-deleted user', async () => {
      repo.findOne.mockResolvedValue(buildUser({ status: UserStatus.DELETED }));

      await service.softDelete('user-1');

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('getProfileOrThrow', () => {
    it('returns a profile projection (no passwordHash)', async () => {
      repo.findOne.mockResolvedValue(buildUser());
      const profile = await service.getProfileOrThrow('user-1');
      expect(profile).toMatchObject({
        id: 'user-1',
        email: 'user@example.com',
      });
      expect((profile as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it('throws 404 when missing', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getProfileOrThrow('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('changeEmail', () => {
    it('updates when the new email is free', async () => {
      repo.findOne.mockResolvedValue(null);
      await service.changeEmail('user-1', 'New@Example.com');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'user-1' },
        { email: 'new@example.com' },
      );
    });

    it('409 when the email is taken by someone else', async () => {
      repo.findOne.mockResolvedValue(buildUser({ id: 'other' }));
      await expect(
        service.changeEmail('user-1', 'taken@example.com'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('activate / markLoggedIn', () => {
    it('activate sets status ACTIVE', async () => {
      await service.activate('user-1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'user-1' },
        { status: UserStatus.ACTIVE },
      );
    });

    it('markLoggedIn stamps lastLoginAt', async () => {
      await service.markLoggedIn('user-1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'user-1' },
        expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      );
    });
  });

  describe('list', () => {
    const makeQb = (rows: User[]) => {
      const qb: Record<string, jest.Mock> = {};
      for (const m of [
        'select',
        'orderBy',
        'addOrderBy',
        'limit',
        'andWhere',
      ]) {
        qb[m] = jest.fn().mockReturnValue(qb);
      }
      qb.getMany = jest.fn().mockResolvedValue(rows);
      return qb;
    };

    const query = (
      over: Partial<ListUsersQueryDto> = {},
    ): ListUsersQueryDto => ({
      limit: 20,
      sort: UserSortField.CREATED_AT,
      order: SortOrder.DESC,
      ...over,
    });

    it('returns items without a nextCursor when there is no next page', async () => {
      repo.createQueryBuilder.mockReturnValue(makeQb([buildUser()]));
      const res = await service.list(query());
      expect(res.items).toHaveLength(1);
      expect(res.nextCursor).toBeNull();
      expect(res.items[0]).not.toHaveProperty('passwordHash');
    });

    it('emits a nextCursor when there is an extra row (limit+1)', async () => {
      const rows = [buildUser({ id: 'a' }), buildUser({ id: 'b' })];
      repo.createQueryBuilder.mockReturnValue(makeQb(rows));
      const res = await service.list(query({ limit: 1 }));
      expect(res.items).toHaveLength(1);
      expect(typeof res.nextCursor).toBe('string');
    });

    it('applies status and search filters', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);
      await service.list(query({ status: UserStatus.ACTIVE, q: 'foo' }));
      expect(qb.andWhere).toHaveBeenCalledWith('user.status = :status', {
        status: UserStatus.ACTIVE,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(user.email ILIKE :q OR user.displayName ILIKE :q)',
        { q: '%foo%' },
      );
    });
  });
});
