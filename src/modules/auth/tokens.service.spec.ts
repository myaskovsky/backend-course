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

  it('issues an access/refresh pair signed with independent secrets', async () => {
    const pair = await service.issueTokenPair({
      userId: 'user-1',
      email: 'user@example.com',
      roles: ['admin'],
    });

    const access = await service.verifyAccess(pair.accessToken);
    expect(access.sub).toBe('user-1');
    expect(access.type).toBe('access');
    expect(access.roles).toEqual(['admin']);

    const refresh = await service.verifyRefresh(pair.refreshToken);
    expect(refresh.type).toBe('refresh');

    // An access token must not verify against the refresh secret.
    await expect(service.verifyRefresh(pair.accessToken)).rejects.toBeDefined();
  });
});
