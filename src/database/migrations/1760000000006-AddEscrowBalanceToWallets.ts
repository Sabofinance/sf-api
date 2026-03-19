import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEscrowBalanceToWallets1760000000006 implements MigrationInterface {
  name = 'AddEscrowBalanceToWallets1760000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD COLUMN "escrow_balance" numeric(18,2) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "escrow_balance"`);
  }
}