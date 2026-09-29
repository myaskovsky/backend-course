import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from './config.service';

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConfigService],
    }).compile();

    service = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('returns a value from the internal config', () => {
      const svc = new ConfigService({ PORT: '4000' });
      expect(svc.get('PORT')).toBe('4000');
    });

    it('returns undefined for a key that is not set', () => {
      const svc = new ConfigService({});
      expect(svc.get('SMTP_HOST')).toBeUndefined();
    });

    it('reads values loaded by ConfigModule through DI', async () => {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            load: [() => ({ COOKIE_SAMESITE: 'strict' })],
          }),
        ],
        providers: [ConfigService],
      }).compile();
      expect(module.get(ConfigService).get('COOKIE_SAMESITE')).toBe('strict');
    });
  });
});
