import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ChallengeType {
  REGISTRATION = 'registration',
  LOGIN = 'login',
  EMAIL_CHANGE = 'email_change',
  SELF_DELETE = 'self_delete',
  PASSWORD_RESET = 'password_reset',
}

@Entity({ name: 'email_challenges' })
@Index('idx_email_challenges_user', ['userId'])
export class EmailChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ChallengeType })
  type: ChallengeType;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /** target address the code was sent to (for email-change this is the new email) */
  @Column({ type: 'varchar', length: 320 })
  email: string;

  /** argon2 hash of the 6-digit code — never stored in plaintext */
  @Column({ type: 'varchar' })
  codeHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz' })
  lastSentAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
