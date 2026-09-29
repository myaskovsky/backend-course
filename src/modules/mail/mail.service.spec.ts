import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

import { ConfigService } from '@/core/config/config.service';

import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('MailService', () => {
  const createTransport = nodemailer.createTransport as unknown as jest.Mock;
  let transporter: { verify: jest.Mock; sendMail: jest.Mock };

  const makeService = (values: Record<string, string>) => {
    const config = {
      get: (k: string) => values[k],
    } as unknown as ConfigService;
    return new MailService(config);
  };

  const smtpEnv = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '2525',
    SMTP_SECURE: 'false',
    SMTP_USER: 'smtp-user',
    SMTP_PASSWORD: 'smtp-pass',
    SMTP_FROM: 'noreply@example.com',
  };

  beforeEach(() => {
    transporter = {
      verify: jest.fn().mockResolvedValue(true),
      sendMail: jest.fn().mockResolvedValue({ messageId: 'm1' }),
    };
    createTransport.mockReset().mockReturnValue(transporter);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs the OTP (does not throw) when SMTP is not configured', async () => {
    const service = makeService({});
    await service.onModuleInit(); // no SMTP_HOST → transporter stays null
    await expect(
      service.sendOtp('u@example.com', '123456', 'login'),
    ).resolves.toBeUndefined();
    expect(createTransport).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalled();
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('code=123456'),
    );
  });

  describe('with SMTP configured', () => {
    it('creates a STARTTLS transport with auth and verifies it', async () => {
      const service = makeService(smtpEnv);
      await service.onModuleInit();
      expect(createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 2525,
        secure: false,
        requireTLS: true,
        auth: { user: 'smtp-user', pass: 'smtp-pass' },
      });
      expect(transporter.verify).toHaveBeenCalled();
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('SMTP transport ready'),
      );
    });

    it('uses implicit TLS without requireTLS when SMTP_SECURE is true', async () => {
      const service = makeService({ ...smtpEnv, SMTP_SECURE: 'true' });
      await service.onModuleInit();
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ secure: true, requireTLS: false }),
      );
    });

    it('defaults the port to 587 when SMTP_PORT is not set', async () => {
      const service = makeService({ ...smtpEnv, SMTP_PORT: '' });
      await service.onModuleInit();
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 587 }),
      );
    });

    it('logs (does not throw) when verify fails with an Error', async () => {
      transporter.verify.mockRejectedValue(new Error('auth failed'));
      const service = makeService(smtpEnv);
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('auth failed'),
      );
    });

    it('logs a non-Error verify rejection as a string', async () => {
      transporter.verify.mockRejectedValue('boom');
      const service = makeService(smtpEnv);
      await service.onModuleInit();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('boom'),
      );
    });

    it('sends the OTP email with from/to/subject/text', async () => {
      const service = makeService(smtpEnv);
      await service.onModuleInit();
      await service.sendOtp('user@example.com', '654321', 'email_change');
      expect(transporter.sendMail).toHaveBeenCalledWith({
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Confirm your new email',
        text: 'Your confirmation code is 654321. It expires in 10 minutes.',
      });
    });

    it.each([
      ['registration', 'Confirm your registration'],
      ['login', 'Confirm your login'],
      ['self_delete', 'Confirm account deletion'],
      ['password_reset', 'Reset your password'],
    ] as const)('uses the right subject for %s', async (scenario, subject) => {
      const service = makeService(smtpEnv);
      await service.onModuleInit();
      await service.sendOtp('user@example.com', '111111', scenario);
      expect(transporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject }),
      );
    });

    it('propagates sendMail failures to the caller', async () => {
      transporter.sendMail.mockRejectedValue(new Error('550 rejected'));
      const service = makeService(smtpEnv);
      await service.onModuleInit();
      await expect(
        service.sendOtp('user@example.com', '111111', 'login'),
      ).rejects.toThrow('550 rejected');
    });
  });
});
