import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1758800000000 implements MigrationInterface {
  name = 'CreateUsers1758800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "users_status_enum" AS ENUM ('active', 'blocked', 'deleted')`,
    );
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying(320) NOT NULL,
        "passwordHash" character varying NOT NULL,
        "status" "users_status_enum" NOT NULL DEFAULT 'active',
        "photo" character varying,
        "displayName" character varying(255),
        "lastLoginAt" timestamptz,
        "deletedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "users_status_enum"`);
  }
}
