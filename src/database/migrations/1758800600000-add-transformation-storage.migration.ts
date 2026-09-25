import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransformationStorage1758800600000 implements MigrationInterface {
  name = 'AddTransformationStorage1758800600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transformation_history" ADD COLUMN "fileId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_history" ADD COLUMN "resultSize" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_history" ADD COLUMN "expiresAt" timestamptz`,
    );

    // Backfill a retention window for pre-existing rows (default 90 days).
    await queryRunner.query(
      `UPDATE "transformation_history" SET "expiresAt" = "createdAt" + interval '90 days' WHERE "expiresAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_transformation_history_expires" ON "transformation_history" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_transformation_history_expires"`);
    await queryRunner.query(
      `ALTER TABLE "transformation_history" DROP COLUMN "expiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_history" DROP COLUMN "resultSize"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_history" DROP COLUMN "fileId"`,
    );
  }
}
