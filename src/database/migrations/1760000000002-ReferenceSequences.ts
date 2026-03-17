import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReferenceSequences1760000000002 implements MigrationInterface {
  name = 'ReferenceSequences1760000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reference_sequences" (
        "year" int NOT NULL,
        "scope" varchar(16) NOT NULL,
        "seq" int NOT NULL DEFAULT 0,
        PRIMARY KEY ("year","scope")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "reference_sequences"`);
  }
}

