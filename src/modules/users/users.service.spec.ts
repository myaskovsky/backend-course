import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
      tokensValidAfter: null,
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

    it('revokes all sessions when an admin blocks the user', async () => {
      repo.findOne.mockResolvedValue(buildUser());
      await service.updateProfile('user-1', { status: UserStatus.BLOCKED }, [
        'status',
      ]);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.status).toBe(UserStatus.BLOCKED);
      expect(saved.tokensValidAfter).toBeInstanceOf(Date);
    });

    it('does not revoke sessions when the status stays active', async () => {
      repo.findOne.mockResolvedValue(buildUser());
      await service.updateProfile('user-1', { status: UserStatus.ACTIVE }, [
        'status',
      ]);
      expect(repo.save.mock.calls[0][0].tokensValidAfter).toBeNull();
    });
  });

  describe('session revocation', () => {
    it('setPassword also revokes every existing session', async () => {
      await service.setPassword('user-1', 'new-hash');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'user-1' },
        { passwordHash: 'new-hash', tokensValidAfter: expect.any(Date) },
      );
    });

    it('revokeAllSessions stamps tokensValidAfter', async () => {
      await service.revokeAllSessions('user-1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'user-1' },
        { tokensValidAfter: expect.any(Date) },
      );
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
      expect(saved.tokensValidAfter).toBeInstanceOf(Date);
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
      expect(
        (profile as unknown as Record<string, unknown>).passwordHash,
      ).toBeUndefined();
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
    const ID_A = '00000000-0000-4000-8000-00000000000a';
    const ID_B = '00000000-0000-4000-8000-00000000000b';

    const makeQb = (rows: User[], cursorValues?: Array<string | null>) => {
      const qb: Record<string, jest.Mock> = {};
      for (const m of [
        'select',
        'addSelect',
        'orderBy',
        'addOrderBy',
        'limit',
        'andWhere',
      ]) {
        qb[m] = jest.fn().mockReturnValue(qb);
      }
      qb.getRawAndEntities = jest.fn().mockResolvedValue({
        entities: rows,
        raw: rows.map((u, i) => ({
          cursor_value:
            cursorValues?.[i] !== undefined
              ? cursorValues[i]
              : '2026-01-01 00:00:00.123456+00',
        })),
      });
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

    const encode = (payload: unknown) =>
      Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    const decode = (cursor: string) =>
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;

    it('returns items without a nextCursor when there is no next page', async () => {
      repo.createQueryBuilder.mockReturnValue(makeQb([buildUser()]));
      const res = await service.list(query());
      expect(res.items).toHaveLength(1);
      expect(res.nextCursor).toBeNull();
      expect(res.items[0]).not.toHaveProperty('passwordHash');
      expect(res.items[0]).not.toHaveProperty('tokensValidAfter');
    });

    it('emits a full-precision cursor bound to sort/order when there is an extra row', async () => {
      const rows = [buildUser({ id: ID_A }), buildUser({ id: ID_B })];
      repo.createQueryBuilder.mockReturnValue(
        makeQb(rows, ['2026-01-01 00:00:00.123456+00', 'x']),
      );
      const res = await service.list(query({ limit: 1 }));
      expect(res.items).toHaveLength(1);
      expect(decode(res.nextCursor!)).toEqual({
        v: '2026-01-01 00:00:00.123456+00',
        id: ID_A,
        s: UserSortField.CREATED_AT,
        o: SortOrder.DESC,
      });
    });

    it('orders NULLs last with the id as a tie-breaker', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);
      await service.list(
        query({ sort: UserSortField.LAST_LOGIN, order: SortOrder.ASC }),
      );
      expect(qb.orderBy).toHaveBeenCalledWith(
        '"user"."lastLoginAt"',
        'ASC',
        'NULLS LAST',
      );
      expect(qb.addOrderBy).toHaveBeenCalledWith('"user"."id"', 'ASC');
    });

    it('applies the status filter and escapes LIKE wildcards in q', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);
      await service.list(query({ status: UserStatus.ACTIVE, q: '50%_off\\' }));
      expect(qb.andWhere).toHaveBeenCalledWith('user.status = :status', {
        status: UserStatus.ACTIVE,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        "(user.email ILIKE :q ESCAPE '\\' OR user.displayName ILIKE :q ESCAPE '\\')",
        { q: '%50\\%\\_off\\\\%', qId: '50%_off\\' },
      );
    });

    it('also matches an exact id when q is a UUID', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);
      await service.list(query({ q: ID_A }));
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('OR user.id = :qId'),
        expect.objectContaining({ qId: ID_A }),
      );
    });

    it('applies a keyset condition for a valid cursor', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);
      const cursor = encode({
        v: '2026-01-01 00:00:00+00',
        id: ID_A,
        s: 'created_at',
        o: 'desc',
      });
      await service.list(query({ cursor }));
      expect(qb.andWhere).toHaveBeenCalledWith(
        '("user"."createdAt", "user"."id") < (:cursorValue, :cursorId)',
        { cursorValue: '2026-01-01 00:00:00+00', cursorId: ID_A },
      );
    });

    it('lets the NULL tail through for a nullable sort column', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);
      const cursor = encode({
        v: '2026-01-01 00:00:00+00',
        id: ID_A,
        s: 'last_login',
        o: 'asc',
      });
      await service.list(
        query({ cursor, sort: UserSortField.LAST_LOGIN, order: SortOrder.ASC }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(("user"."lastLoginAt", "user"."id") > (:cursorValue, :cursorId) OR "user"."lastLoginAt" IS NULL)',
        expect.any(Object),
      );
    });

    it('advances by id only inside the NULL tail', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);
      const cursor = encode({ v: null, id: ID_A, s: 'last_login', o: 'desc' });
      await service.list(query({ cursor, sort: UserSortField.LAST_LOGIN }));
      expect(qb.andWhere).toHaveBeenCalledWith(
        '("user"."lastLoginAt" IS NULL AND "user"."id" < :cursorId)',
        { cursorValue: null, cursorId: ID_A },
      );
    });

    it.each([
      ['not base64 json', 'garbage!!'],
      ['wrong shape', encode({ foo: 1 })],
      [
        'non-uuid id',
        encode({ v: 'x', id: 'nope', s: 'created_at', o: 'desc' }),
      ],
      [
        'null value for a non-null column',
        encode({ v: null, id: ID_A, s: 'created_at', o: 'desc' }),
      ],
    ])('rejects an invalid cursor (%s) with 400', async (_label, cursor) => {
      repo.createQueryBuilder.mockReturnValue(makeQb([]));
      await expect(service.list(query({ cursor }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a cursor produced for a different sort/order', async () => {
      repo.createQueryBuilder.mockReturnValue(makeQb([]));
      const cursor = encode({ v: 'a@x.io', id: ID_A, s: 'email', o: 'asc' });
      await expect(service.list(query({ cursor }))).rejects.toThrow(
        'Cursor does not match the requested sort/order',
      );
    });
  });
});
