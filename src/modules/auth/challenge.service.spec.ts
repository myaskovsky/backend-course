import { BadRequestException, HttpException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { MailService } from '@/modules/mail/mail.service';

import { ChallengeService } from './challenge.service';
import {
  ChallengeType,
  EmailChallenge,
} from './entities/email-challenge.entity';

describe('ChallengeService', () => {
  let service: ChallengeService;
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock<Promise<EmailChallenge>, [EmailChallenge]>;
  };
  let mail: jest.Mocked<Pick<MailService, 'sendOtp'>>;

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn(
        (data: Partial<EmailChallenge>) => data as EmailChallenge,
      ),
      save: jest.fn((c: EmailChallenge) => {
        c.id = c.id ?? 'ch-1';
        return Promise.resolve(c);
      }),
    };
    mail = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    service = new ChallengeService(
      repo as unknown as Repository<EmailChallenge>,
      mail as unknown as MailService,
    );
  });

  const issueAndCapture = async () => {
    repo.findOne.mockResolvedValueOnce(null); // no recent challenge
    await service.issue({
      type: ChallengeType.LOGIN,
      email: 'u@example.com',
      userId: 'user-1',
    });
    const saved = repo.save.mock.calls[0][0];
    // recover the plaintext code from the sendOtp call
    const code = mail.sendOtp.mock.calls[0][1];
    return { saved, code };
  };

  it('issues a challenge, hashes the code and emails it', async () => {
    const { saved, code } = await issueAndCapture();
    expect(code).toMatch(/^\d{6}$/);
    expect(saved.codeHash).not.toContain(code);
    expect(saved.codeHash).toMatch(/^\$argon2id\$/);
    expect(mail.sendOtp).toHaveBeenCalledWith('u@example.com', code, 'login');
  });

  it('throttles resends within the resend window', async () => {
    repo.findOne.mockResolvedValueOnce({
      lastSentAt: new Date(),
      consumedAt: null,
    } as EmailChallenge);

    await expect(
      service.issue({
        type: ChallengeType.LOGIN,
        email: 'u@example.com',
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('verifies a correct code and consumes the challenge', async () => {
    const { saved, code } = await issueAndCapture();
    repo.findOne.mockResolvedValueOnce({ ...saved, id: 'ch-1', attempts: 0 });

    const result = await service.verifyAndConsume(
      'ch-1',
      code,
      ChallengeType.LOGIN,
    );
    expect(result.consumedAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong code', async () => {
    const { saved } = await issueAndCapture();
    repo.findOne.mockResolvedValueOnce({ ...saved, id: 'ch-1', attempts: 0 });

    await expect(
      service.verifyAndConsume('ch-1', '000000', ChallengeType.LOGIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired code', async () => {
    const { saved, code } = await issueAndCapture();
    repo.findOne.mockResolvedValueOnce({
      ...saved,
      id: 'ch-1',
      attempts: 0,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.verifyAndConsume('ch-1', code, ChallengeType.LOGIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a type mismatch', async () => {
    const { saved, code } = await issueAndCapture();
    repo.findOne.mockResolvedValueOnce({ ...saved, id: 'ch-1', attempts: 0 });

    await expect(
      service.verifyAndConsume('ch-1', code, ChallengeType.EMAIL_CHANGE),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('resend', () => {
    it('throttles resend within the window (429)', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 'ch-1',
        type: ChallengeType.LOGIN,
        email: 'u@example.com',
        lastSentAt: new Date(),
        consumedAt: null,
      } as EmailChallenge);

      await expect(service.resend('ch-1')).rejects.toBeInstanceOf(
        HttpException,
      );
    });

    it('re-issues a new code and resets attempts after the window', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 'ch-1',
        type: ChallengeType.LOGIN,
        email: 'u@example.com',
        lastSentAt: new Date(Date.now() - 61_000),
        attempts: 4,
        consumedAt: null,
      } as EmailChallenge);

      const res = await service.resend('ch-1');
      expect(res).toEqual({ challengeId: 'ch-1' });
      const saved = repo.save.mock.calls.at(-1)![0];
      expect(saved.attempts).toBe(0);
      expect(mail.sendOtp).toHaveBeenCalled();
    });

    it('rejects an unknown/consumed challenge', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.resend('missing')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
