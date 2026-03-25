import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTradeRatings1760000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trade_ratings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trade_id" uuid NOT NULL REFERENCES "trades" ("id") ON DELETE CASCADE,
        "rater_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "rated_user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "score" int NOT NULL CHECK (score >= 1 AND score <= 5),
        "comment" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_trade_rater" UNIQUE ("trade_id", "rater_id")
      )
    `);
    
    // Indexes for fast querying of a user's ratings
    await queryRunner.query(`CREATE INDEX "IDX_trade_ratings_rated_user" ON "trade_ratings" ("rated_user_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_trade_ratings_rated_user"`);
    await queryRunner.query(`DROP TABLE "trade_ratings"`);
  }
}