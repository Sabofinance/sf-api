import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGovernanceSecurity1760000000016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "otp_purpose" varchar(64)`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "otp_target_email" varchar(320)`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "deleted_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "profile_picture_url" varchar(1024)`);

    await queryRunner.query(`
      CREATE TYPE "admin_invite_granted_role_enum" AS ENUM ('admin', 'super_admin');

      CREATE TABLE "admin_invites" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "token_hash" varchar(64) NOT NULL UNIQUE,
        "inviter_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "invited_email" varchar(320) NOT NULL,
        "granted_role" "admin_invite_granted_role_enum" NOT NULL DEFAULT 'admin',
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz NULL,
        "consumed_by" uuid NULL REFERENCES "users" ("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX "IDX_admin_invites_inviter" ON "admin_invites" ("inviter_id");
      CREATE INDEX "IDX_admin_invites_invited_email" ON "admin_invites" ("invited_email");
      CREATE INDEX "IDX_admin_invites_expires" ON "admin_invites" ("expires_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_invites"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "admin_invite_granted_role_enum"`);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "profile_picture_url"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "otp_target_email"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "otp_purpose"`);
  }
}

