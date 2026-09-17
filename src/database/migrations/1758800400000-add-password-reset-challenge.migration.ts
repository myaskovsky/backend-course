import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetChallenge1758800400000 implements MigrationInterface {
  name = 'AddPasswordResetChallenge1758800400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "email_challenges_type_enum" ADD VALUE IF NOT EXISTS 'password_reset'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing a value from an enum type;
    // 'password_reset' is intentionally left in place on rollback.
  }
}
