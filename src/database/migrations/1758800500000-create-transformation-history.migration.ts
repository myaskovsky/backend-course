import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransformationHistory1758800500000 implements MigrationInterface {
  name = 'CreateTransformationHistory1758800500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "transformation_history_type_enum" AS ENUM ('file', 'image')`,
    );
    await queryRunner.query(
      `CREATE TYPE "transformation_history_status_enum" AS ENUM ('success', 'error')`,
    );

    await queryRunner.query(`
      CREATE TABLE "transformation_history" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "type" "transformation_history_type_enum" NOT NULL DEFAULT 'file',
        "sourceFormat" character varying(16) NOT NULL,
        "targetFormat" character varying(16) NOT NULL,
        "status" "transformation_history_status_enum" NOT NULL,
        "errorCode" character varying(64),
        "fileSize" integer NOT NULL,
        "durationMs" integer NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_transformation_history_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_transformation_history_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_transformation_history_user_created" ON "transformation_history" ("userId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_transformation_history_type" ON "transformation_history" ("type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_transformation_history_status" ON "transformation_history" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_transformation_history_status"`);
    await queryRunner.query(`DROP INDEX "idx_transformation_history_type"`);
    await queryRunner.query(
      `DROP INDEX "idx_transformation_history_user_created"`,
    );
    await queryRunner.query(`DROP TABLE "transformation_history"`);
    await queryRunner.query(`DROP TYPE "transformation_history_status_enum"`);
    await queryRunner.query(`DROP TYPE "transformation_history_type_enum"`);
  }
}
