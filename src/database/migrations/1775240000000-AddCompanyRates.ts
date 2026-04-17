import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompanyRates1775240000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "company_rates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "currency" varchar(8) NOT NULL,
        "rate_ngn" numeric(18,2) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_company_rates_currency" ON "company_rates" ("currency")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_company_rates_currency"`);
    await queryRunner.query(`DROP TABLE "company_rates"`);
  }
}
