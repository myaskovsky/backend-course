import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokenRevocation1758800800000 implements MigrationInterface {
  name = 'AddTokenRevocation1758800800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Denylist of individually revoked JWTs (logout, refresh rotation). Rows
    // are only needed until the token would have expired anyway.
    await queryRunner.query(`
      CREATE TABLE "revoked_tokens" (
        "jti" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "type" character varying(16) NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "revokedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_revoked_tokens_jti" PRIMARY KEY ("jti"),
        CONSTRAINT "fk_revoked_tokens_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_revoked_tokens_expires" ON "revoked_tokens" ("expiresAt")`,
    );

    // Revokes every token of a user at once (password change/reset, delete,
    // block): tokens issued before this instant are rejected.
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "tokensValidAfter" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "tokensValidAfter"`,
    );
    await queryRunner.query(`DROP TABLE "revoked_tokens"`);
  }
}
