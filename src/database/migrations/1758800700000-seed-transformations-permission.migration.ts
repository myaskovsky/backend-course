import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedTransformationsPermission1758800700000 implements MigrationInterface {
  name = 'SeedTransformationsPermission1758800700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Permission gating admin access to any user's transformation history and
    // saved files (see AdminTransformationsController).
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions") VALUES ('transformations', ARRAY['read','download'])`,
    );
    // Grant it to the admin role (NULL actions => all actions of the permission).
    await queryRunner.query(`
      INSERT INTO "grants" ("roleId", "permissionId", "actions")
      SELECT r.id, p.id, NULL
      FROM "roles" r, "permissions" p
      WHERE r.name = 'admin' AND p.name = 'transformations'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "grants" WHERE "permissionId" = (SELECT id FROM "permissions" WHERE name = 'transformations')`,
    );
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name = 'transformations'`,
    );
  }
}
