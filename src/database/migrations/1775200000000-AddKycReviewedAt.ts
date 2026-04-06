import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKycReviewedAt1775200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc"
      ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc"
      DROP COLUMN IF EXISTS "reviewed_at"
    `);
  }
}
