import { UnauthorizedException } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';
import { User, UserStatus } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: jest.Mocked<Pick<UsersService, 'findByIdWithRoles'>>;

  const config = {
    get: () => 'access-secret',
  } as unknown as ConfigService;

  const activeUser = {
    id: 'u1',
    email: 'u@example.com',
    status: UserStatus.ACTIVE,
    roles: [{ name: 'admin' }],
  } as unknown as User;

  beforeEach(() => {
    usersService = { findByIdWithRoles: jest.fn() };
    strategy = new JwtStrategy(config, usersService as unknown as UsersService);
  });

  it('returns the request user with roles from the DB', async () => {
    usersService.findByIdWithRoles.mockResolvedValue(activeUser);
    const result = await strategy.validate({
      sub: 'u1',
      email: 'u@example.com',
      type: 'access',
    });
    expect(result).toEqual({
      userId: 'u1',
      email: 'u@example.com',
      roles: ['admin'],
    });
  });

  it('rejects a non-access token type', async () => {
    await expect(
      strategy.validate({ sub: 'u1', email: 'u@example.com', type: 'refresh' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the user is missing or not active', async () => {
    usersService.findByIdWithRoles.mockResolvedValue(null);
    await expect(
      strategy.validate({ sub: 'u1', email: 'u@example.com', type: 'access' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    usersService.findByIdWithRoles.mockResolvedValue({
      ...activeUser,
      status: UserStatus.BLOCKED,
    } as User);
    await expect(
      strategy.validate({ sub: 'u1', email: 'u@example.com', type: 'access' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
