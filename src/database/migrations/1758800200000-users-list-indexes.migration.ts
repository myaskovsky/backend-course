import { MigrationInterface, QueryRunner } from 'typeorm';

export class UsersListIndexes1758800200000 implements MigrationInterface {
  name = 'UsersListIndexes1758800200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Supports status filtering and keyset pagination on the default sort.
    await queryRunner.query(
      `CREATE INDEX "idx_users_status" ON "users" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_created_at_id" ON "users" ("createdAt", "id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_users_created_at_id"`);
    await queryRunner.query(`DROP INDEX "idx_users_status"`);
  }
}
