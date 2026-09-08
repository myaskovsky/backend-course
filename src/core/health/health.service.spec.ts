import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  const check = jest.fn().mockResolvedValue({ status: 'ok' });
  const pingCheck = jest.fn().mockResolvedValue({ database: { status: 'up' } });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: HealthCheckService, useValue: { check } },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck } },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('checkHealth runs a database ping check', async () => {
    await service.checkHealth();
    expect(check).toHaveBeenCalledWith([expect.any(Function)]);
    // invoke the indicator thunk passed to check()
    const thunk = check.mock.calls[0][0][0] as () => unknown;
    await thunk();
    expect(pingCheck).toHaveBeenCalledWith('database');
  });
});
