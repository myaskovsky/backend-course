import { ConfigService } from '@/core/config/config.service';

import { MailService } from './mail.service';

describe('MailService', () => {
  const makeService = (values: Record<string, string>) => {
    const config = {
      get: (k: string) => values[k],
    } as unknown as ConfigService;
    return new MailService(config);
  };

  it('logs the OTP (does not throw) when SMTP is not configured', async () => {
    const service = makeService({});
    await service.onModuleInit(); // no SMTP_HOST → transporter stays null
    await expect(
      service.sendOtp('u@example.com', '123456', 'login'),
    ).resolves.toBeUndefined();
  });
});
