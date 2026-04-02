import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepositRejectionReason1775145500000 implements MigrationInterface {
  name = 'AddDepositRejectionReason1775145500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "deposits" ADD COLUMN "rejection_reason" text NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "deposits" DROP COLUMN IF EXISTS "rejection_reason"`);
  }
}