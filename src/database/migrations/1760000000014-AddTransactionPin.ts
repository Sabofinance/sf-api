import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransactionPin1760000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "transaction_pin_hash" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "transaction_pin_set" boolean NOT NULL DEFAULT false`);
    
    await queryRunner.query(`ALTER TABLE "trades" ADD "buyer_pin_verified" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "trades" ADD "seller_pin_verified" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "trades" ADD "pin_expires_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "trades" ADD "seller_notified_at" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "seller_notified_at"`);
    await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "pin_expires_at"`);
    await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "seller_pin_verified"`);
    await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "buyer_pin_verified"`);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "transaction_pin_set"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "transaction_pin_hash"`);
  }
}