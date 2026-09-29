import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { User, UserStatus } from './entities/user.entity';
import {
  ListUsersQueryDto,
  SortOrder,
  UserSortField,
} from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

export interface CreateUserData {
  email: string;
  passwordHash: string;
  displayName?: string | null;
  status?: UserStatus;
}

export interface UserProfile {
  id: string;
  email: string;
  status: UserStatus;
  displayName: string | null;
  photo: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface UserListItem {
  id: string;
  email: string;
  photo: string | null;
  displayName: string | null;
  status: UserStatus;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface PaginatedUsers {
  items: UserListItem[];
  nextCursor: string | null;
}

/** Sort column SQL and whether it can hold NULLs (affects keyset logic). */
const SORT_COLUMN: Record<
  UserSortField,
  { column: string; nullable: boolean }
> = {
  [UserSortField.CREATED_AT]: { column: '"user"."createdAt"', nullable: false },
  [UserSortField.LAST_LOGIN]: {
    column: '"user"."lastLoginAt"',
    nullable: true,
  },
  [UserSortField.EMAIL]: { column: '"user"."email"', nullable: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque cursor: last row's sort value + id, bound to the sort it came from. */
interface CursorPayload {
  v: string | null;
  id: string;
  s: UserSortField;
  o: SortOrder;
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  create(data: CreateUserData): Promise<User> {
    const user = this.usersRepository.create({
      email: data.email,
      passwordHash: data.passwordHash,
      displayName: data.displayName ?? null,
      status: data.status ?? UserStatus.ACTIVE,
    });

    return this.usersRepository.save(user);
  }

  async activate(id: string): Promise<void> {
    await this.usersRepository.update({ id }, { status: UserStatus.ACTIVE });
  }

  /** Sets a new password hash and revokes every existing session. */
  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.usersRepository.update(
      { id },
      { passwordHash, tokensValidAfter: new Date() },
    );
  }

  /** Revokes every token issued to the user so far (all devices). */
  async revokeAllSessions(id: string): Promise<void> {
    await this.usersRepository.update({ id }, { tokensValidAfter: new Date() });
  }

  /**
   * Changes a user's email with a uniqueness check. Used by both the admin
   * path and the confirmed self-service email-change flow.
   */
  @Transactional()
  async changeEmail(id: string, newEmail: string): Promise<void> {
    const email = newEmail.toLowerCase().trim();
    const existing = await this.findByEmail(email);
    if (existing && existing.id !== id) {
      throw new ConflictException('Email already in use');
    }
    await this.usersRepository.update({ id }, { email });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  findByIdWithRoles(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
      relations: { roles: true },
    });
  }

  async markLoggedIn(id: string): Promise<void> {
    await this.usersRepository.update({ id }, { lastLoginAt: new Date() });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  findByIdWithPassword(id: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
  }

  /**
   * Returns a user's profile. `scope` controls field visibility (default-deny):
   * - 'self'  → full profile (owner viewing themselves)
   * - 'support' → reduced set for a permitted third party (no displayName/photo/lastLogin)
   */
  async getProfileOrThrow(
    id: string,
    scope: 'self' | 'support' = 'self',
  ): Promise<UserProfile> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const profile = this.toProfile(user);
    if (scope === 'support') {
      return {
        ...profile,
        displayName: null,
        photo: null,
        lastLoginAt: null,
      };
    }
    return profile;
  }

  /**
   * Applies a role-scoped patch. Only the fields in `allowedFields` are written;
   * anything else in the DTO is ignored (default-deny).
   */
  @Transactional()
  async updateProfile(
    id: string,
    dto: UpdateUserDto,
    allowedFields: Array<keyof UpdateUserDto>,
  ): Promise<UserProfile> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (allowedFields.includes('email') && dto.email !== undefined) {
      const email = dto.email.toLowerCase().trim();
      if (email !== user.email) {
        const existing = await this.findByEmail(email);
        if (existing && existing.id !== id) {
          throw new ConflictException('Email already in use');
        }
        user.email = email;
      }
    }
    if (
      allowedFields.includes('displayName') &&
      dto.displayName !== undefined
    ) {
      user.displayName = dto.displayName;
    }
    if (allowedFields.includes('photo') && dto.photo !== undefined) {
      user.photo = dto.photo;
    }
    if (allowedFields.includes('status') && dto.status !== undefined) {
      if (dto.status !== user.status && dto.status !== UserStatus.ACTIVE) {
        // Blocking a user must also kill the sessions they already hold.
        user.tokensValidAfter = new Date();
      }
      user.status = dto.status;
    }

    const saved = await this.usersRepository.save(user);
    return this.toProfile(saved);
  }

  /**
   * Soft-delete + anonymize. Idempotent: a user already deleted is left as-is.
   */
  @Transactional()
  async softDelete(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.status === UserStatus.DELETED) {
      // Idempotent — nothing more to do.
      return;
    }

    user.status = UserStatus.DELETED;
    user.deletedAt = new Date();
    // Anonymize PII while keeping the row for audit/foreign-key integrity.
    user.email = `deleted+${user.id}@example.invalid`;
    user.displayName = null;
    user.photo = null;
    // Rotate the password hash to a random value so the account can't be used.
    user.passwordHash = `deleted:${user.id}`;
    user.tokensValidAfter = new Date();

    await this.usersRepository.save(user);
    this.logger.log(`User soft-deleted and anonymized: ${id}`);
  }

  async list(
    query: ListUsersQueryDto,
    actorUserId?: string,
  ): Promise<PaginatedUsers> {
    const cursor = query.cursor ? this.decodeCursor(query.cursor, query) : null;
    const { column, nullable } = SORT_COLUMN[query.sort];
    const direction = query.order === SortOrder.ASC ? 'ASC' : 'DESC';
    const cmp = query.order === SortOrder.ASC ? '>' : '<';

    const qb = this.usersRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.photo',
        'user.displayName',
        'user.status',
        'user.createdAt',
        'user.lastLoginAt',
      ])
      // Full-precision sort value for the cursor: timestamptz carries
      // microseconds, which a JS Date would silently truncate.
      .addSelect(`${column}::text`, 'cursor_value')
      .orderBy(column, direction, 'NULLS LAST')
      .addOrderBy('"user"."id"', direction)
      .limit(query.limit + 1);

    if (query.status) {
      qb.andWhere('user.status = :status', { status: query.status });
    }
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      const byId = UUID_RE.test(query.q) ? ' OR user.id = :qId' : '';
      qb.andWhere(
        `(user.email ILIKE :q ESCAPE '\\' OR user.displayName ILIKE :q ESCAPE '\\'${byId})`,
        { q: pattern, qId: query.q },
      );
    }
    if (cursor) {
      this.applyCursor(qb, column, nullable, cmp, cursor);
    }

    const { entities, raw } = await qb.getRawAndEntities<{
      cursor_value: string | null;
    }>();
    const hasMore = entities.length > query.limit;
    const items = entities.slice(0, query.limit);

    const nextCursor = hasMore
      ? this.encodeCursor(
          {
            v: raw[items.length - 1].cursor_value,
            id: items[items.length - 1].id,
          },
          query,
        )
      : null;

    // Audit (spec 1.5): no free-text query, only the shape of the request.
    this.logger.log(
      `users.list actor=${actorUserId ?? 'unknown'} status=${query.status ?? '-'} ` +
        `sort=${query.sort}:${query.order} limit=${query.limit} q=${query.q ? 'yes' : 'no'} ` +
        `cursor=${cursor ? 'yes' : 'no'} returned=${items.length}`,
    );

    return {
      items: items.map((u) => this.toListItem(u)),
      nextCursor,
    };
  }

  /**
   * Keyset condition for "rows after the cursor" in (sort column, id) order.
   * NULL sort values (only `last_login`) sort last in both directions, so a
   * cursor inside the non-null part must also let the NULL tail through, and a
   * cursor inside the NULL tail can only advance by id.
   */
  private applyCursor(
    qb: SelectQueryBuilder<User>,
    column: string,
    nullable: boolean,
    cmp: '<' | '>',
    cursor: CursorPayload,
  ): void {
    const params = { cursorValue: cursor.v, cursorId: cursor.id };
    if (cursor.v === null) {
      qb.andWhere(
        `(${column} IS NULL AND "user"."id" ${cmp} :cursorId)`,
        params,
      );
      return;
    }
    const rowCmp = `(${column}, "user"."id") ${cmp} (:cursorValue, :cursorId)`;
    qb.andWhere(nullable ? `(${rowCmp} OR ${column} IS NULL)` : rowCmp, params);
  }

  private toProfile(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      displayName: user.displayName,
      photo: user.photo,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  private toListItem(user: User): UserListItem {
    return {
      id: user.id,
      email: user.email,
      photo: user.photo,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  private encodeCursor(
    position: Pick<CursorPayload, 'v' | 'id'>,
    query: ListUsersQueryDto,
  ): string {
    const payload: CursorPayload = {
      ...position,
      s: query.sort,
      o: query.order,
    };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  /**
   * Decodes and validates a cursor. A malformed cursor, or one produced for a
   * different sort/order, is rejected with 400 instead of silently restarting
   * from the first page.
   */
  private decodeCursor(
    cursor: string,
    query: ListUsersQueryDto,
  ): CursorPayload {
    let parsed: Partial<CursorPayload>;
    try {
      parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Partial<CursorPayload>;
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
    const valid =
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof parsed.id === 'string' &&
      UUID_RE.test(parsed.id) &&
      (typeof parsed.v === 'string' || parsed.v === null) &&
      (parsed.v !== null || SORT_COLUMN[query.sort].nullable);
    if (!valid) {
      throw new BadRequestException('Invalid cursor');
    }
    if (parsed.s !== query.sort || parsed.o !== query.order) {
      throw new BadRequestException(
        'Cursor does not match the requested sort/order',
      );
    }
    return parsed as CursorPayload;
  }
}
