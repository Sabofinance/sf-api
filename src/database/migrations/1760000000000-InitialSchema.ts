import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1760000000000 implements MigrationInterface {
  name = 'InitialSchema1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    await queryRunner.query(
      `CREATE TYPE "currency_enum" AS ENUM ('NGN','GBP','USD','CAD')`,
    );
    await queryRunner.query(
      `CREATE TYPE "deposit_status_enum" AS ENUM ('initiated','pending_review','completed','failed','rejected')`,
    );
    await queryRunner.query(
      `CREATE TYPE "kyc_status_enum" AS ENUM ('unverified','pending','verified','rejected')`,
    );
    await queryRunner.query(
      `CREATE TYPE "ledger_type_enum" AS ENUM ('deposit','withdrawal','trade_debit','trade_credit','escrow_hold','escrow_release','reversal','adjustment')`,
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(200) NOT NULL,
        "email" varchar(320) NOT NULL,
        "phone" varchar(32) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "email_verified" boolean NOT NULL DEFAULT false,
        "phone_verified" boolean NOT NULL DEFAULT false,
        "kyc_status" "kyc_status_enum" NOT NULL DEFAULT 'unverified',
        "is_suspended" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_email" ON "users" ("email")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_phone" ON "users" ("phone")`);

    await queryRunner.query(`
      CREATE TABLE "wallets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "currency" "currency_enum" NOT NULL,
        "balance" numeric(18,2) NOT NULL DEFAULT 0,
        "locked_balance" numeric(18,2) NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_wallet_user_currency" UNIQUE ("user_id","currency")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_user" ON "wallets" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "ledger" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "reference" varchar(32) NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "wallet_id" uuid NOT NULL REFERENCES "wallets" ("id") ON DELETE RESTRICT,
        "type" "ledger_type_enum" NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "currency" "currency_enum" NOT NULL,
        "balance_before" numeric(18,2) NOT NULL,
        "balance_after" numeric(18,2) NOT NULL,
        "initiated_by" uuid NOT NULL,
        "related_id" uuid NULL,
        "status" varchar(32) NOT NULL DEFAULT 'completed',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ledger_reference" ON "ledger" ("reference")`);
    await queryRunner.query(`CREATE INDEX "IDX_ledger_user" ON "ledger" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_ledger_wallet" ON "ledger" ("wallet_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_ledger_created_at" ON "ledger" ("created_at")`);

    await queryRunner.query(`
      CREATE TABLE "deposits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "currency" "currency_enum" NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "provider" varchar(64) NOT NULL,
        "provider_reference" varchar(128) NULL,
        "proof_url" text NULL,
        "status" "deposit_status_enum" NOT NULL DEFAULT 'initiated',
        "reviewed_by" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_deposits_user" ON "deposits" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_deposits_status" ON "deposits" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_deposits_created_at" ON "deposits" ("created_at")`);

    await queryRunner.query(`
      CREATE TABLE "exchange_rates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "pair" varchar(16) NOT NULL,
        "rate" numeric(18,6) NOT NULL,
        "source" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_rates_pair_created_at" ON "exchange_rates" ("pair","created_at")`);

    await queryRunner.query(`
      CREATE TABLE "kyc" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "document_type" varchar(64) NOT NULL,
        "document_url" text NOT NULL,
        "selfie_url" text NOT NULL,
        "status" "kyc_status_enum" NOT NULL DEFAULT 'pending',
        "rejection_reason" text NULL,
        "reviewed_by" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_kyc_user" ON "kyc" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_kyc_status" ON "kyc" ("status")`);

    await queryRunner.query(`
      CREATE TABLE "admin_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "admin_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "action" varchar(64) NOT NULL,
        "target_type" varchar(64) NOT NULL,
        "target_id" uuid NOT NULL,
        "details" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_admin_logs_admin" ON "admin_logs" ("admin_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_admin_logs_target" ON "admin_logs" ("target_type","target_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "admin_logs"');
    await queryRunner.query('DROP TABLE IF EXISTS "kyc"');
    await queryRunner.query('DROP TABLE IF EXISTS "exchange_rates"');
    await queryRunner.query('DROP TABLE IF EXISTS "deposits"');
    await queryRunner.query('DROP TABLE IF EXISTS "ledger"');
    await queryRunner.query('DROP TABLE IF EXISTS "wallets"');
    await queryRunner.query('DROP TABLE IF EXISTS "users"');

    await queryRunner.query('DROP TYPE IF EXISTS "ledger_type_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "kyc_status_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "deposit_status_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "currency_enum"');
  }
}

