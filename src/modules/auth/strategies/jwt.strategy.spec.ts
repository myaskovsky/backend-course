import { UnauthorizedException } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';
import { User, UserStatus } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { JwtPayload } from '../auth.constants';
import { TokenRevocationService } from '../token-revocation.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: jest.Mocked<Pick<UsersService, 'findByIdWithRoles'>>;
  let tokenRevocation: jest.Mocked<Pick<TokenRevocationService, 'isRevoked'>>;

  const config = {
    get: () => 'access-secret',
  } as unknown as ConfigService;

  const activeUser = {
    id: 'u1',
    email: 'u@example.com',
    status: UserStatus.ACTIVE,
    tokensValidAfter: null,
    roles: [{ name: 'admin' }],
  } as unknown as User;

  const payload = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
    sub: 'u1',
    email: 'u@example.com',
    type: 'access',
    jti: 'jti-1',
    iat: 1_700_000_000,
    exp: 1_700_000_900,
    ...overrides,
  });

  beforeEach(() => {
    usersService = { findByIdWithRoles: jest.fn() };
    tokenRevocation = { isRevoked: jest.fn().mockResolvedValue(false) };
    strategy = new JwtStrategy(
      config,
      usersService as unknown as UsersService,
      tokenRevocation as unknown as TokenRevocationService,
    );
  });

  it('returns the request user with roles from the DB', async () => {
    usersService.findByIdWithRoles.mockResolvedValue(activeUser);
    const result = await strategy.validate(payload());
    expect(result).toEqual({
      userId: 'u1',
      email: 'u@example.com',
      roles: ['admin'],
    });
    expect(tokenRevocation.isRevoked).toHaveBeenCalledWith(
      payload(),
      activeUser,
    );
  });

  it('rejects a non-access token type', async () => {
    await expect(
      strategy.validate(payload({ type: 'refresh' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the user is missing or not active', async () => {
    usersService.findByIdWithRoles.mockResolvedValue(null);
    await expect(strategy.validate(payload())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    usersService.findByIdWithRoles.mockResolvedValue({
      ...activeUser,
      status: UserStatus.BLOCKED,
    } as User);
    await expect(strategy.validate(payload())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a revoked token immediately', async () => {
    usersService.findByIdWithRoles.mockResolvedValue(activeUser);
    tokenRevocation.isRevoked.mockResolvedValue(true);
    await expect(strategy.validate(payload())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
