import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWithdrawals1760000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "withdrawal_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed', 'rejected')`);
    await queryRunner.query(`
      CREATE TABLE "withdrawals" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "reference" varchar(32) NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "beneficiary_id" uuid NOT NULL REFERENCES "beneficiaries" ("id") ON DELETE RESTRICT,
        "currency" "currency_enum" NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "status" "withdrawal_status_enum" NOT NULL DEFAULT 'pending',
        "provider_reference" varchar(128) NULL,
        "failure_reason" text NULL,
        "reviewed_by" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_withdrawals_reference" ON "withdrawals" ("reference")`);
    await queryRunner.query(`CREATE INDEX "IDX_withdrawals_user" ON "withdrawals" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_withdrawals_status" ON "withdrawals" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_withdrawals_status"`);
    await queryRunner.query(`DROP INDEX "IDX_withdrawals_user"`);
    await queryRunner.query(`DROP INDEX "IDX_withdrawals_reference"`);
    await queryRunner.query(`DROP TABLE "withdrawals"`);
    await queryRunner.query(`DROP TYPE "withdrawal_status_enum"`);
  }
}