import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSabits1760000000007 implements MigrationInterface {
  name = 'AddSabits1760000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "sabit_type_enum" AS ENUM ('BUY', 'SELL')`);
    await queryRunner.query(`CREATE TYPE "sabit_status_enum" AS ENUM ('active', 'completed', 'cancelled', 'suspended')`);

    await queryRunner.query(`
      CREATE TABLE "sabits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "type" "sabit_type_enum" NOT NULL,
        "currency" "currency_enum" NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "available_amount" numeric(18,2) NOT NULL,
        "rate_ngn" numeric(18,2) NOT NULL,
        "payment_methods" jsonb NULL,
        "status" "sabit_status_enum" NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_sabit_user" ON "sabits" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_sabit_status_currency" ON "sabits" ("status", "currency")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sabits"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "sabit_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "sabit_status_enum"`);
  }
}