import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrades1760000000008 implements MigrationInterface {
  name = 'AddTrades1760000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "trade_status_enum" AS ENUM ('initiated', 'escrowed', 'confirmed', 'completed', 'cancelled', 'disputed')`);

    await queryRunner.query(`
      CREATE TABLE "trades" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "sabit_id" uuid NOT NULL REFERENCES "sabits" ("id") ON DELETE RESTRICT,
        "buyer_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "seller_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "currency" "currency_enum" NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "rate_ngn" numeric(18,2) NOT NULL,
        "total_ngn" numeric(18,2) NOT NULL,
        "status" "trade_status_enum" NOT NULL DEFAULT 'initiated',
        "reference" varchar(32) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_trades_reference" ON "trades" ("reference")`);
    await queryRunner.query(`CREATE INDEX "IDX_trades_sabit" ON "trades" ("sabit_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_trades_buyer" ON "trades" ("buyer_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_trades_seller" ON "trades" ("seller_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "trades"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "trade_status_enum"`);
  }
}