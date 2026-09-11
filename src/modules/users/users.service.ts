import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

const SORT_COLUMN: Record<UserSortField, string> = {
  [UserSortField.CREATED_AT]: 'user.createdAt',
  [UserSortField.LAST_LOGIN]: 'user.lastLoginAt',
  [UserSortField.EMAIL]: 'user.email',
};

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

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.usersRepository.update({ id }, { passwordHash });
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

    await this.usersRepository.save(user);
    this.logger.log(`User soft-deleted and anonymized: ${id}`);
  }

  async list(query: ListUsersQueryDto): Promise<PaginatedUsers> {
    const column = SORT_COLUMN[query.sort];
    const direction = query.order === SortOrder.ASC ? 'ASC' : 'DESC';
    const comparator = query.order === SortOrder.ASC ? '>' : '<';

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
      .orderBy(column, direction)
      .addOrderBy('user.id', direction)
      .limit(query.limit + 1);

    if (query.status) {
      qb.andWhere('user.status = :status', { status: query.status });
    }
    if (query.q) {
      qb.andWhere('(user.email ILIKE :q OR user.displayName ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    if (query.cursor) {
      const decoded = this.decodeCursor(query.cursor);
      if (decoded) {
        qb.andWhere(
          `(${column}, user.id) ${comparator} (:cursorValue, :cursorId)`,
          {
            cursorValue: decoded.value,
            cursorId: decoded.id,
          },
        );
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);

    const nextCursor = hasMore
      ? this.encodeCursor(items[items.length - 1], query.sort)
      : null;

    return {
      items: items.map((u) => this.toListItem(u)),
      nextCursor,
    };
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

  private cursorValueFor(user: User, sort: UserSortField): string {
    switch (sort) {
      case UserSortField.EMAIL:
        return user.email;
      case UserSortField.LAST_LOGIN:
        return user.lastLoginAt ? user.lastLoginAt.toISOString() : '';
      case UserSortField.CREATED_AT:
      default:
        return user.createdAt.toISOString();
    }
  }

  private encodeCursor(user: User, sort: UserSortField): string {
    const payload = JSON.stringify({
      value: this.cursorValueFor(user, sort),
      id: user.id,
    });
    return Buffer.from(payload, 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string): { value: string; id: string } | null {
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as { value?: unknown; id?: unknown };
      if (typeof parsed.value === 'string' && typeof parsed.id === 'string') {
        return { value: parsed.value, id: parsed.id };
      }
      return null;
    } catch {
      return null;
    }
  }
}
