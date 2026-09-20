import * as argon2 from 'argon2';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRbac1758800100000 implements MigrationInterface {
  name = 'CreateRbac1758800100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(64) NOT NULL,
        "description" character varying(255),
        CONSTRAINT "pk_roles_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_roles_name" ON "roles" ("name")`,
    );

    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(64) NOT NULL,
        "actions" text[] NOT NULL DEFAULT '{}',
        CONSTRAINT "pk_permissions_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_permissions_name" ON "permissions" ("name")`,
    );

    await queryRunner.query(`
      CREATE TABLE "grants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "roleId" uuid NOT NULL,
        "permissionId" uuid NOT NULL,
        "actions" text[],
        CONSTRAINT "pk_grants_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_grants_role" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_grants_permission" FOREIGN KEY ("permissionId") REFERENCES "permissions" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_grants_role_permission" ON "grants" ("roleId", "permissionId")`,
    );

    await queryRunner.query(`
      CREATE TABLE "user_roles" (
        "userId" uuid NOT NULL,
        "roleId" uuid NOT NULL,
        CONSTRAINT "pk_user_roles" PRIMARY KEY ("userId", "roleId"),
        CONSTRAINT "fk_user_roles_user" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_user_roles_role" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_user_roles_role" ON "user_roles" ("roleId")`,
    );

    // ---- Seed default RBAC config + admin user ----
    await queryRunner.query(
      `INSERT INTO "roles" ("name", "description") VALUES ('admin', 'Full administrative access')`,
    );
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions") VALUES
        ('users', ARRAY['create','read','update','delete','list']),
        ('rbac', ARRAY['read','create','update','delete'])`,
    );
    // admin granted all actions on both resources (NULL actions => all)
    await queryRunner.query(`
      INSERT INTO "grants" ("roleId", "permissionId", "actions")
      SELECT r.id, p.id, NULL
      FROM "roles" r CROSS JOIN "permissions" p
      WHERE r.name = 'admin' AND p.name IN ('users', 'rbac')
    `);

    const adminEmail = (
      process.env.ADMIN_EMAIL ?? 'admin@example.com'
    ).toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin-change-me';
    const passwordHash = await argon2.hash(adminPassword, {
      type: argon2.argon2id,
    });

    await queryRunner.query(
      `INSERT INTO "users" ("email", "passwordHash", "status") VALUES ($1, $2, 'active')`,
      [adminEmail, passwordHash],
    );
    await queryRunner.query(
      `
      INSERT INTO "user_roles" ("userId", "roleId")
      SELECT u.id, r.id FROM "users" u, "roles" r
      WHERE u.email = $1 AND r.name = 'admin'
    `,
      [adminEmail],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const adminEmail = (
      process.env.ADMIN_EMAIL ?? 'admin@example.com'
    ).toLowerCase();
    await queryRunner.query(`DELETE FROM "users" WHERE email = $1`, [
      adminEmail,
    ]);
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TABLE "grants"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
  }
}
