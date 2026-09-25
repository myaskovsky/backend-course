import { ConfigService } from '@/core/config/config.service';

import { TransformationCleanupService } from './transformation-cleanup.service';
import { TransformationsService } from './transformations.service';

function setup() {
  const purgeExpired = jest.fn().mockResolvedValue(0);
  const transformations = {
    purgeExpired,
  } as unknown as TransformationsService;
  const config = {
    get: () => 3_600_000,
  } as unknown as ConfigService;
  const service = new TransformationCleanupService(config, transformations);
  return { service, purgeExpired };
}

describe('TransformationCleanupService', () => {
  afterEach(() => jest.useRealTimers());

  it('runs an initial purge on init and schedules a timer', () => {
    jest.useFakeTimers();
    const { service, purgeExpired } = setup();
    service.onModuleInit();
    expect(purgeExpired).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(3_600_000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    jest.advanceTimersByTime(3_600_000);
    expect(purgeExpired).toHaveBeenCalledTimes(2); // stopped
  });

  it('swallows purge errors so the timer keeps running', async () => {
    const { service, purgeExpired } = setup();
    purgeExpired.mockRejectedValueOnce(new Error('db down'));
    await expect(service.run()).resolves.toBeUndefined();
  });
});
