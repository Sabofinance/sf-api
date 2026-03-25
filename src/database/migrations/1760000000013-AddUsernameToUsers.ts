import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsernameToUsers1760000000013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add as nullable
    await queryRunner.query(`ALTER TABLE "users" ADD "username" varchar(30)`);
    
    // 2. Populate existing users (fallback: user + first 8 chars of ID)
    await queryRunner.query(`
      UPDATE "users" 
      SET "username" = 'user' || substr(replace(id::text, '-', ''), 1, 8)
      WHERE "username" IS NULL
    `);

    // 3. Set NOT NULL
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL`);

    // 4. Add unique index
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_username" ON "users" ("username")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_username"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
  }
}