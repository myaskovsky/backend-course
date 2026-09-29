import { JwtService } from '@nestjs/jwt';

import { ConfigService } from '@/core/config/config.service';

import { TokensService } from './tokens.service';

describe('TokensService', () => {
  const configValues: Record<string, string> = {
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_ACCESS_TTL: '900',
    JWT_REFRESH_TTL: '2592000',
  };

  const config = {
    get: (key: string) => configValues[key],
  } as unknown as ConfigService;
  const service = new TokensService(new JwtService(), config);
  const subject = { userId: 'user-1', email: 'user@example.com' };

  it('issues an access/refresh pair signed with independent secrets', async () => {
    const pair = await service.issueTokenPair(subject);

    const access = await service.verifyAccess(pair.accessToken);
    expect(access.sub).toBe('user-1');
    expect(access.email).toBe('user@example.com');
    expect(access.type).toBe('access');

    const refresh = await service.verifyRefresh(pair.refreshToken);
    expect(refresh.type).toBe('refresh');

    // Tokens must not verify against the other type's secret.
    await expect(service.verifyRefresh(pair.accessToken)).rejects.toBeDefined();
    await expect(service.verifyAccess(pair.refreshToken)).rejects.toBeDefined();
  });

  it('gives every token a unique jti', async () => {
    const first = await service.issueTokenPair(subject);
    const second = await service.issueTokenPair(subject);

    const jtis = await Promise.all([
      service.verifyAccess(first.accessToken),
      service.verifyRefresh(first.refreshToken),
      service.verifyAccess(second.accessToken),
      service.verifyRefresh(second.refreshToken),
    ]).then((payloads) => payloads.map((p) => p.jti));

    expect(new Set(jtis).size).toBe(4);
    jtis.forEach((jti) => expect(jti).toMatch(/^[0-9a-f-]{36}$/));
  });

  it('sets a millisecond-precision iat and a TTL-based exp', async () => {
    const before = Date.now();
    const pair = await service.issueTokenPair(subject);
    const after = Date.now();

    const access = await service.verifyAccess(pair.accessToken);
    expect(access.iat * 1000).toBeGreaterThanOrEqual(before);
    expect(access.iat * 1000).toBeLessThanOrEqual(after);
    expect(access.exp - access.iat).toBeCloseTo(900, 0);

    const refresh = await service.verifyRefresh(pair.refreshToken);
    expect(refresh.exp - refresh.iat).toBeCloseTo(2592000, 0);
  });

  it('exposes the configured TTLs', () => {
    expect(service.accessTtl()).toBe(900);
    expect(service.refreshTtl()).toBe(2592000);
  });
});
