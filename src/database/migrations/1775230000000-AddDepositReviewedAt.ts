import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepositReviewedAt1775230000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "deposits"
      ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "deposits"
      DROP COLUMN IF EXISTS "reviewed_at"
    `);
  }
}
