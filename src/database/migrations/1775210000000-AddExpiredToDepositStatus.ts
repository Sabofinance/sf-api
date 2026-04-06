import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpiredToDepositStatus1775210000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "deposit_status_enum" ADD VALUE IF NOT EXISTS 'expired'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres does not support removing enum values directly.
    // To revert: recreate the type without 'expired' and migrate existing rows.
  }
}
