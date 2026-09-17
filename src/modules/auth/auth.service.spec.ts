import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';
import { User, UserStatus } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { AuthService } from './auth.service';
import { ChallengeService } from './challenge.service';
import { ChallengeType } from './entities/email-challenge.entity';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';

jest.mock('typeorm-transactional', () => ({
  Transactional: () => () => undefined,
}));

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<
    Pick<
      UsersService,
      | 'findByEmail'
      | 'findByEmailWithPassword'
      | 'findByIdWithPassword'
      | 'findById'
      | 'create'
      | 'markLoggedIn'
      | 'activate'
      | 'setPassword'
    >
  >;
  let passwordService: jest.Mocked<Pick<PasswordService, 'hash' | 'verify'>>;
  let tokensService: jest.Mocked<
    Pick<TokensService, 'issueTokenPair' | 'verifyRefresh'>
  >;
  let challengeService: jest.Mocked<
    Pick<
      ChallengeService,
      'issue' | 'verifyAndConsume' | 'verifyAndConsumeByEmail' | 'resend'
    >
  >;
  let configValues: Record<string, string>;

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: 'hashed',
      status: UserStatus.ACTIVE,
      photo: null,
      displayName: null,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as User;

  const tokenPair = { accessToken: 'a', refreshToken: 'r' };

  beforeEach(async () => {
    configValues = {
      CONFIRM_REGISTRATION_ENABLED: 'false',
      CONFIRM_LOGIN_ENABLED: 'false',
      CONFIRM_PASSWORD_RECOVERY: 'true',
    };
    usersService = {
      findByEmail: jest.fn(),
      findByEmailWithPassword: jest.fn(),
      findByIdWithPassword: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      markLoggedIn: jest.fn().mockResolvedValue(undefined),
      activate: jest.fn().mockResolvedValue(undefined),
      setPassword: jest.fn().mockResolvedValue(undefined),
    };
    passwordService = {
      hash: jest.fn().mockResolvedValue('hashed'),
      verify: jest.fn().mockResolvedValue(true),
    };
    tokensService = {
      issueTokenPair: jest.fn().mockResolvedValue(tokenPair),
      verifyRefresh: jest.fn(),
    };
    challengeService = {
      issue: jest.fn().mockResolvedValue({ challengeId: 'ch-1' }),
      verifyAndConsume: jest.fn(),
      verifyAndConsumeByEmail: jest.fn(),
      resend: jest.fn().mockResolvedValue({ challengeId: 'ch-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: PasswordService, useValue: passwordService },
        { provide: TokensService, useValue: tokensService },
        { provide: ChallengeService, useValue: challengeService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configValues[key] },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register', () => {
    it('creates an active user when confirmation is disabled', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(buildUser());

      const result = await service.register({
        email: 'User@Example.com',
        password: 'password123',
      });

      expect(usersService.create).toHaveBeenCalledWith({
        email: 'user@example.com',
        passwordHash: 'hashed',
        displayName: null,
        status: UserStatus.ACTIVE,
      });
      expect(result).toMatchObject({ email: 'user@example.com' });
      expect(challengeService.issue).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email with 409', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());

      await expect(
        service.register({
          email: 'user@example.com',
          password: 'password123',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('creates a pending user and issues an OTP when confirmation is enabled', async () => {
      configValues.CONFIRM_REGISTRATION_ENABLED = 'true';
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(
        buildUser({ status: UserStatus.PENDING }),
      );

      const result = await service.register({
        email: 'new@example.com',
        password: 'password123',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: UserStatus.PENDING }),
      );
      expect(challengeService.issue).toHaveBeenCalled();
      expect(result).toEqual({
        requiresConfirmation: true,
        challengeId: 'ch-1',
      });
    });
  });

  describe('confirmRegistration', () => {
    it('activates the user and issues tokens', async () => {
      challengeService.verifyAndConsume.mockResolvedValue({
        userId: 'user-1',
      } as never);
      usersService.findById.mockResolvedValue(buildUser());

      const result = await service.confirmRegistration({
        challengeId: 'ch-1',
        code: '123456',
      });

      expect(usersService.activate).toHaveBeenCalledWith('user-1');
      expect(result.tokens).toEqual(tokenPair);
    });
  });

  describe('login', () => {
    it('issues tokens on valid credentials', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(buildUser());

      const result = await service.login({
        email: 'user@example.com',
        password: 'password123',
      });

      expect('tokens' in result && result.tokens).toEqual(tokenPair);
      expect(challengeService.issue).not.toHaveBeenCalled();
    });

    it('returns a challenge when login confirmation is enabled', async () => {
      configValues.CONFIRM_LOGIN_ENABLED = 'true';
      usersService.findByEmailWithPassword.mockResolvedValue(buildUser());

      const result = await service.login({
        email: 'user@example.com',
        password: 'password123',
      });

      expect(result).toEqual({
        requiresConfirmation: true,
        challengeId: 'ch-1',
      });
      expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('returns a neutral 401 for an unknown email', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nope@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns a neutral 401 for a wrong password', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(buildUser());
      passwordService.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'user@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('rotates the token pair for a valid refresh token', async () => {
      tokensService.verifyRefresh.mockResolvedValue({
        sub: 'user-1',
        email: 'user@example.com',
        type: 'refresh',
      });
      usersService.findById.mockResolvedValue(buildUser());

      const result = await service.refresh('valid-refresh');

      expect(result).toEqual(tokenPair);
    });

    it('rejects a missing refresh token', async () => {
      await expect(service.refresh(undefined)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an access token presented at the refresh endpoint', async () => {
      tokensService.verifyRefresh.mockResolvedValue({
        sub: 'user-1',
        email: 'user@example.com',
        type: 'access',
      });

      await expect(service.refresh('access-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('password reset', () => {
    it('request issues an OTP for an active user', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());
      await service.requestPasswordReset({ email: 'user@example.com' });
      expect(challengeService.issue).toHaveBeenCalledWith(
        expect.objectContaining({ type: ChallengeType.PASSWORD_RESET }),
      );
    });

    it('request is neutral (no throw, no OTP) for an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await expect(
        service.requestPasswordReset({ email: 'nope@example.com' }),
      ).resolves.toBeUndefined();
      expect(challengeService.issue).not.toHaveBeenCalled();
    });

    it('confirm verifies the OTP by email and sets the new password', async () => {
      challengeService.verifyAndConsumeByEmail.mockResolvedValue({
        userId: 'user-1',
      } as never);
      await service.confirmPasswordReset({
        email: 'User@example.com',
        code: '123456',
        newPassword: 'newpassword123',
      });
      expect(challengeService.verifyAndConsumeByEmail).toHaveBeenCalledWith(
        'user@example.com',
        '123456',
        ChallengeType.PASSWORD_RESET,
      );
      expect(usersService.setPassword).toHaveBeenCalledWith('user-1', 'hashed');
    });
  });

  describe('changePassword', () => {
    it('sets a new password after verifying the current one', async () => {
      usersService.findByIdWithPassword.mockResolvedValue(buildUser());
      await service.changePassword('user-1', {
        currentPassword: 'password123',
        newPassword: 'newpassword123',
      });
      expect(passwordService.verify).toHaveBeenCalledWith(
        'hashed',
        'password123',
      );
      expect(usersService.setPassword).toHaveBeenCalledWith('user-1', 'hashed');
    });

    it('rejects a wrong current password with 400', async () => {
      usersService.findByIdWithPassword.mockResolvedValue(buildUser());
      passwordService.verify.mockResolvedValue(false);
      await expect(
        service.changePassword('user-1', {
          currentPassword: 'wrong',
          newPassword: 'newpassword123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(usersService.setPassword).not.toHaveBeenCalled();
    });
  });

  describe('resendOtp', () => {
    it('delegates to the challenge service', async () => {
      const res = await service.resendOtp('ch-1');
      expect(challengeService.resend).toHaveBeenCalledWith('ch-1');
      expect(res).toEqual({ challengeId: 'ch-1' });
    });
  });
});
