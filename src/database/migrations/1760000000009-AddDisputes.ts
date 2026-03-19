import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisputes1760000000009 implements MigrationInterface {
  name = 'AddDisputes1760000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "dispute_status_enum" AS ENUM ('open', 'resolved', 'closed')`);

    await queryRunner.query(`
      CREATE TABLE "disputes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trade_id" uuid NOT NULL REFERENCES "trades" ("id") ON DELETE RESTRICT,
        "raised_by_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "reason" text NOT NULL,
        "status" "dispute_status_enum" NOT NULL DEFAULT 'open',
        "resolved_by_id" uuid NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "resolution_notes" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_disputes_trade" ON "disputes" ("trade_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_disputes_status" ON "disputes" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "disputes"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "dispute_status_enum"`);
  }
}