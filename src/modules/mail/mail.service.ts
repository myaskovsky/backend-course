import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import { ConfigService } from '@/core/config/config.service';

export type OtpScenario =
  | 'registration'
  | 'login'
  | 'email_change'
  | 'self_delete'
  | 'password_reset';

const SUBJECTS: Record<OtpScenario, string> = {
  registration: 'Confirm your registration',
  login: 'Confirm your login',
  email_change: 'Confirm your new email',
  self_delete: 'Confirm account deletion',
  password_reset: 'Reset your password',
};

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const host = this.configService.get('SMTP_HOST');
    if (!host) {
      this.logger.warn(
        'SMTP_HOST not configured — OTP codes will be logged, not emailed',
      );
      return;
    }

    const secure = String(this.configService.get('SMTP_SECURE')) === 'true';
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(this.configService.get('SMTP_PORT')) || 587,
      secure,
      // turboSMTP on port 587 uses STARTTLS (secure=false) — enforce TLS upgrade.
      requireTLS: !secure,
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASSWORD'),
      },
    });

    // Verify credentials/connectivity at startup for early diagnostics.
    try {
      await this.transporter.verify();
      this.logger.log(`SMTP transport ready (host=${host})`);
    } catch (err) {
      this.logger.error(
        `SMTP verify failed (host=${host}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async sendOtp(
    to: string,
    code: string,
    scenario: OtpScenario,
  ): Promise<void> {
    const subject = SUBJECTS[scenario];
    const text = `Your confirmation code is ${code}. It expires in 10 minutes.`;

    if (!this.transporter) {
      // Dev fallback: no SMTP configured.
      this.logger.log(`[DEV OTP] to=${to} scenario=${scenario} code=${code}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.configService.get('SMTP_FROM'),
      to,
      subject,
      text,
    });
    this.logger.log(`OTP email sent to ${to} (${scenario})`);
  }
}
