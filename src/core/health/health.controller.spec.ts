import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ConfigService } from '@/core/config/config.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: { getEmptyResponse: jest.Mock; checkHealth: jest.Mock };
  let configGet: jest.Mock;

  beforeEach(async () => {
    healthService = {
      getEmptyResponse: jest
        .fn()
        .mockReturnValue({ status: 'ok', details: {} }),
      checkHealth: jest.fn().mockResolvedValue({
        status: 'ok',
        details: { database: { status: 'up' } },
      }),
    };
    configGet = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useValue: healthService },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns the empty response when HEALTH_CHECK_ENABLED is falsy', async () => {
    configGet.mockReturnValue(false);
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      details: {},
    });
    expect(configGet).toHaveBeenCalledWith('HEALTH_CHECK_ENABLED');
    expect(healthService.getEmptyResponse).toHaveBeenCalled();
    expect(healthService.checkHealth).not.toHaveBeenCalled();
  });

  it('returns the empty response when HEALTH_CHECK_ENABLED is unset', async () => {
    configGet.mockReturnValue(undefined);
    await controller.check();
    expect(healthService.getEmptyResponse).toHaveBeenCalled();
    expect(healthService.checkHealth).not.toHaveBeenCalled();
  });

  it('runs the real health check when HEALTH_CHECK_ENABLED is true', async () => {
    configGet.mockReturnValue(true);
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      details: { database: { status: 'up' } },
    });
    expect(healthService.checkHealth).toHaveBeenCalled();
    expect(healthService.getEmptyResponse).not.toHaveBeenCalled();
  });
});
