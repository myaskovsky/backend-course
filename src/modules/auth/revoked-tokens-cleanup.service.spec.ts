import { ConfigService } from '@/core/config/config.service';

import { RevokedTokensCleanupService } from './revoked-tokens-cleanup.service';
import { TokenRevocationService } from './token-revocation.service';

describe('RevokedTokensCleanupService', () => {
  const config = {
    get: () => '60000',
  } as unknown as ConfigService;
  let purgeExpired: jest.Mock;
  let service: RevokedTokensCleanupService;

  beforeEach(() => {
    jest.useFakeTimers();
    purgeExpired = jest.fn().mockResolvedValue(2);
    service = new RevokedTokensCleanupService(config, {
      purgeExpired,
    } as unknown as TokenRevocationService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('purges at startup and then on every interval', () => {
    service.onModuleInit();
    expect(purgeExpired).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
  });

  it('stops the timer on shutdown', () => {
    service.onModuleInit();
    service.onModuleDestroy();
    jest.advanceTimersByTime(120_000);
    expect(purgeExpired).toHaveBeenCalledTimes(1);
  });

  it('swallows purge errors', async () => {
    purgeExpired.mockRejectedValue(new Error('db down'));
    await expect(service.run()).resolves.toBeUndefined();
  });
});
