import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { JwtPayload } from './auth.constants';
import { RevokedToken } from './entities/revoked-token.entity';
import { TokenRevocationService } from './token-revocation.service';

describe('TokenRevocationService', () => {
  let service: TokenRevocationService;
  let execute: jest.Mock;
  let insertBuilder: Record<string, jest.Mock>;
  let repo: {
    createQueryBuilder: jest.Mock;
    exists: jest.Mock;
    delete: jest.Mock;
  };

  const payload = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
    sub: 'u1',
    email: 'u@example.com',
    type: 'refresh',
    jti: 'jti-1',
    iat: 1_700_000_000.5,
    exp: 1_700_086_400,
    ...overrides,
  });

  beforeEach(async () => {
    execute = jest.fn().mockResolvedValue({ raw: [{ jti: 'jti-1' }] });
    insertBuilder = {};
    for (const method of [
      'insert',
      'into',
      'values',
      'orIgnore',
      'returning',
    ]) {
      insertBuilder[method] = jest.fn().mockReturnValue(insertBuilder);
    }
    insertBuilder.execute = execute;
    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(insertBuilder),
      exists: jest.fn().mockResolvedValue(false),
      delete: jest.fn().mockResolvedValue({ affected: 3 }),
    };

    const module = await Test.createTestingModule({
      providers: [
        TokenRevocationService,
        { provide: getRepositoryToken(RevokedToken), useValue: repo },
      ],
    }).compile();
    service = module.get(TokenRevocationService);
  });

  describe('revoke', () => {
    it('stores the jti until the token expires and reports a first use', async () => {
      await expect(service.revoke(payload())).resolves.toBe(true);
      expect(insertBuilder.values).toHaveBeenCalledWith({
        jti: 'jti-1',
        userId: 'u1',
        type: 'refresh',
        expiresAt: new Date(1_700_086_400 * 1000),
      });
      expect(insertBuilder.orIgnore).toHaveBeenCalled();
    });

    it('reports false when the jti was already revoked', async () => {
      execute.mockResolvedValue({ raw: [] });
      await expect(service.revoke(payload())).resolves.toBe(false);
    });
  });

  describe('isRevokedForUser', () => {
    it('is false when the user never revoked all sessions', () => {
      expect(
        service.isRevokedForUser(payload(), { tokensValidAfter: null }),
      ).toBe(false);
    });

    it('is true for tokens issued before tokensValidAfter', () => {
      const validAfter = new Date(1_700_000_001 * 1000);
      expect(
        service.isRevokedForUser(payload(), { tokensValidAfter: validAfter }),
      ).toBe(true);
    });

    it('distinguishes tokens within the same second (ms precision)', () => {
      // iat = ...000.5s; revoke-all at ...000.4s → token is newer, still valid
      const validAfter = new Date(1_700_000_000_400);
      expect(
        service.isRevokedForUser(payload(), { tokensValidAfter: validAfter }),
      ).toBe(false);
    });

    it('rejects legacy tokens without a jti', () => {
      expect(
        service.isRevokedForUser(payload({ jti: undefined as never }), {
          tokensValidAfter: null,
        }),
      ).toBe(true);
    });
  });

  describe('isRevoked', () => {
    it('checks the denylist when not revoked for the user', async () => {
      repo.exists.mockResolvedValue(true);
      await expect(
        service.isRevoked(payload(), { tokensValidAfter: null }),
      ).resolves.toBe(true);
      expect(repo.exists).toHaveBeenCalledWith({ where: { jti: 'jti-1' } });
    });

    it('skips the denylist lookup after a revoke-all', async () => {
      await expect(
        service.isRevoked(payload(), { tokensValidAfter: new Date() }),
      ).resolves.toBe(true);
      expect(repo.exists).not.toHaveBeenCalled();
    });

    it('is false for a valid, non-denylisted token', async () => {
      await expect(
        service.isRevoked(payload(), { tokensValidAfter: null }),
      ).resolves.toBe(false);
    });
  });

  it('purgeExpired deletes expired rows and returns the count', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    await expect(service.purgeExpired(now)).resolves.toBe(3);
    expect(repo.delete).toHaveBeenCalledWith({
      expiresAt: expect.objectContaining({ _type: 'lessThan', _value: now }),
    });
  });
});
