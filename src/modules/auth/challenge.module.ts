import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MailModule } from '@/modules/mail/mail.module';

import { ChallengeService } from './challenge.service';
import { EmailChallenge } from './entities/email-challenge.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EmailChallenge]), MailModule],
  providers: [ChallengeService],
  exports: [ChallengeService],
})
export class ChallengeModule {}
