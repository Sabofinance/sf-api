import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoleAndDepositReference1760000000001 implements MigrationInterface {
  name = 'AddRoleAndDepositReference1760000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "user_role_enum" AS ENUM ('user','admin')`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "role" "user_role_enum" NOT NULL DEFAULT 'user'`);

    await queryRunner.query(`ALTER TABLE "deposits" ADD COLUMN "reference" varchar(32)`);
    await queryRunner.query(`UPDATE "deposits" SET "reference" = 'DEP-' || EXTRACT(YEAR FROM now())::int || '-' || lpad((floor(random()*1000000))::int::text, 6, '0') WHERE "reference" IS NULL`);
    await queryRunner.query(`ALTER TABLE "deposits" ALTER COLUMN "reference" SET NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_deposits_reference" ON "deposits" ("reference")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_deposits_reference"`);
    await queryRunner.query(`ALTER TABLE "deposits" DROP COLUMN IF EXISTS "reference"`);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "role"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}

