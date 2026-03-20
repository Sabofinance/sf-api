import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSuperAdminRole1760000000013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // This command adds 'super_admin' to the existing PostgreSQL enum type
    await queryRunner.query(`ALTER TYPE "user_role_enum" ADD VALUE 'super_admin'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: PostgreSQL does not support removing values from an ENUM type easily.
  }
}