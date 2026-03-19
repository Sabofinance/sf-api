import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBeneficiaries1760000000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "beneficiaries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "currency" "currency_enum" NOT NULL,
        "bank_name" varchar(128) NOT NULL,
        "account_name" varchar(200) NOT NULL,
        "account_number" varchar(32) NOT NULL,
        "sort_code" varchar(16) NULL,
        "iban" varchar(64) NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_beneficiaries_user" ON "beneficiaries" ("user_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_beneficiaries_user"`);
    await queryRunner.query(`DROP TABLE "beneficiaries"`);
  }
}