import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { MailService, OtpScenario } from '@/modules/mail/mail.service';

import {
  ChallengeType,
  EmailChallenge,
} from './entities/email-challenge.entity';

// Spec-recommended OTP parameters.
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_MS = 60 * 1000; // 1 minute

export interface IssueChallengeInput {
  type: ChallengeType;
  email: string;
  userId?: string | null;
}

@Injectable()
export class ChallengeService {
  private readonly logger = new Logger(ChallengeService.name);

  constructor(
    @InjectRepository(EmailChallenge)
    private readonly challengeRepo: Repository<EmailChallenge>,
    private readonly mailService: MailService,
  ) {}

  async issue(input: IssueChallengeInput): Promise<{ challengeId: string }> {
    // Resend throttle: block if an unconsumed challenge for the same
    // (type, email) was sent within the resend window.
    const recent = await this.challengeRepo.findOne({
      where: { type: input.type, email: input.email, consumedAt: IsNull() },
      order: { lastSentAt: 'DESC' },
    });
    if (recent && Date.now() - recent.lastSentAt.getTime() < OTP_RESEND_MS) {
      throw new HttpException(
        'Please wait before requesting a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateCode();
    const now = new Date();
    const challenge = await this.challengeRepo.save(
      this.challengeRepo.create({
        type: input.type,
        email: input.email,
        userId: input.userId ?? null,
        codeHash: await argon2.hash(code, { type: argon2.argon2id }),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        attempts: 0,
        lastSentAt: now,
      }),
    );

    await this.mailService.sendOtp(
      input.email,
      code,
      input.type as OtpScenario,
    );
    this.logger.log(`OTP challenge issued: ${challenge.id} (${input.type})`);
    return { challengeId: challenge.id };
  }

  /**
   * Re-issues a fresh code for an existing, still-open challenge, subject to the
   * resend window. Resets the attempt counter and TTL.
   */
  async resend(challengeId: string): Promise<{ challengeId: string }> {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId, consumedAt: IsNull() },
    });
    if (!challenge) {
      throw new BadRequestException('Invalid or already used confirmation');
    }
    if (Date.now() - challenge.lastSentAt.getTime() < OTP_RESEND_MS) {
      throw new HttpException(
        'Please wait before requesting a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateCode();
    challenge.codeHash = await argon2.hash(code, { type: argon2.argon2id });
    challenge.expiresAt = new Date(Date.now() + OTP_TTL_MS);
    challenge.lastSentAt = new Date();
    challenge.attempts = 0;
    await this.challengeRepo.save(challenge);

    await this.mailService.sendOtp(
      challenge.email,
      code,
      challenge.type as OtpScenario,
    );
    this.logger.log(
      `OTP challenge resent: ${challenge.id} (${challenge.type})`,
    );
    return { challengeId: challenge.id };
  }

  /**
   * Verifies a code against a challenge and consumes it on success.
   * Returns the challenge so the caller can complete the underlying action.
   */
  async verifyAndConsume(
    challengeId: string,
    code: string,
    expectedType: ChallengeType,
  ): Promise<EmailChallenge> {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    return this.consume(challenge, code, expectedType);
  }

  /**
   * Same as verifyAndConsume but locates the newest open challenge by email —
   * used by flows where the client doesn't hold the challengeId (password reset,
   * whose request step is intentionally neutral and returns no id).
   */
  async verifyAndConsumeByEmail(
    email: string,
    code: string,
    expectedType: ChallengeType,
  ): Promise<EmailChallenge> {
    const challenge = await this.challengeRepo.findOne({
      where: { email, type: expectedType, consumedAt: IsNull() },
      order: { lastSentAt: 'DESC' },
    });
    return this.consume(challenge, code, expectedType);
  }

  private async consume(
    challenge: EmailChallenge | null,
    code: string,
    expectedType: ChallengeType,
  ): Promise<EmailChallenge> {
    if (!challenge || challenge.type !== expectedType || challenge.consumedAt) {
      throw new BadRequestException('Invalid or expired confirmation');
    }
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Confirmation code has expired');
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new HttpException(
        'Too many attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    challenge.attempts += 1;
    const matches = await this.safeVerify(challenge.codeHash, code);
    if (!matches) {
      await this.challengeRepo.save(challenge);
      throw new BadRequestException('Invalid confirmation code');
    }

    challenge.consumedAt = new Date();
    await this.challengeRepo.save(challenge);
    this.logger.log(
      `OTP challenge confirmed: ${challenge.id} (${challenge.type})`,
    );
    return challenge;
  }

  private generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private async safeVerify(hash: string, code: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, code);
    } catch {
      return false;
    }
  }
}
