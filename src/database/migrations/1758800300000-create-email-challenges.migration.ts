import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmailChallenges1758800300000 implements MigrationInterface {
  name = 'CreateEmailChallenges1758800300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Registration-with-confirmation creates users in a 'pending' state.
    await queryRunner.query(
      `ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'pending'`,
    );

    await queryRunner.query(
      `CREATE TYPE "email_challenges_type_enum" AS ENUM ('registration', 'login', 'email_change', 'self_delete')`,
    );
    await queryRunner.query(`
      CREATE TABLE "email_challenges" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "type" "email_challenges_type_enum" NOT NULL,
        "userId" uuid,
        "email" character varying(320) NOT NULL,
        "codeHash" character varying NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "lastSentAt" timestamptz NOT NULL,
        "consumedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_email_challenges_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_email_challenges_user" ON "email_challenges" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "email_challenges"`);
    await queryRunner.query(`DROP TYPE "email_challenges_type_enum"`);
    // Note: removing an enum value ('pending') is not supported by Postgres and
    // is intentionally left in place on rollback.
  }
}
