import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBids1760000000015 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TYPE "bid_status_enum" AS ENUM ('pending', 'accepted', 'rejected', 'expired', 'withdrawn');
            
            CREATE TABLE "bids" (
              "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              "reference" varchar(32) NOT NULL UNIQUE,
              "sabit_id" uuid NOT NULL REFERENCES "sabits" ("id") ON DELETE RESTRICT,
              "buyer_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
              "seller_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
              "currency" "currency_enum" NOT NULL,
              "amount" numeric(18,2) NOT NULL,
              "proposed_rate_ngn" numeric(18,2) NOT NULL,
              "original_rate_ngn" numeric(18,2) NOT NULL,
              "total_ngn_at_bid_rate" numeric(18,2) NOT NULL,
              "status" "bid_status_enum" NOT NULL DEFAULT 'pending',
              "buyer_pin_verified" boolean NOT NULL DEFAULT false,
              "expires_at" timestamptz NOT NULL,
              "seller_responded_at" timestamptz NULL,
              "rejection_reason" text NULL,
              "created_at" timestamptz NOT NULL DEFAULT now()
            );

            CREATE INDEX "IDX_bids_sabit" ON "bids" ("sabit_id");
            CREATE INDEX "IDX_bids_buyer" ON "bids" ("buyer_id");
            CREATE INDEX "IDX_bids_seller" ON "bids" ("seller_id");
            CREATE INDEX "IDX_bids_status" ON "bids" ("status");
            CREATE UNIQUE INDEX "IDX_bids_reference" ON "bids" ("reference");

            ALTER TABLE "trades" ADD COLUMN "bid_id" uuid NULL REFERENCES "bids" ("id") ON DELETE SET NULL;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "trades" DROP COLUMN "bid_id";
            DROP TABLE "bids";
            DROP TYPE "bid_status_enum";
        `);
    }
}
