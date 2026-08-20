import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlatformKpis1775270000000 implements MigrationInterface {
  name = 'AddPlatformKpis1775270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "security_events"
      ADD COLUMN IF NOT EXISTS "disposition" varchar(32)
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_security_events_disposition_created"
       ON "security_events" ("disposition", "created_at" DESC)
       WHERE "disposition" IS NOT NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE "incident_events"
      ADD COLUMN IF NOT EXISTS "outcome" varchar(32)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_control_closures" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "control_key" varchar(64) NOT NULL UNIQUE,
        "title" varchar(256) NOT NULL,
        "category" varchar(64) NOT NULL,
        "evidence_ref" varchar(512),
        "details" jsonb NOT NULL DEFAULT '{}',
        "closed_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_kpi_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "period_from" timestamptz NOT NULL,
        "period_to" timestamptz NOT NULL,
        "uptime_30d_pct" numeric(8,4) NOT NULL,
        "transaction_success_pct" numeric(8,4) NOT NULL,
        "detection_improvement_pct" numeric(8,4) NOT NULL,
        "detection_method" varchar(64) NOT NULL,
        "intrusions_neutralized" int NOT NULL,
        "vulnerability_gaps_closed" int NOT NULL,
        "definitions" jsonb NOT NULL DEFAULT '{}',
        "breakdown" jsonb NOT NULL DEFAULT '{}',
        "synthetic" boolean NOT NULL DEFAULT false,
        "generated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_platform_kpi_snapshots_generated"
       ON "platform_kpi_snapshots" ("generated_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_kpi_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_control_closures"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_security_events_disposition_created"`,
    );
    await queryRunner.query(`ALTER TABLE "security_events" DROP COLUMN IF EXISTS "disposition"`);
    await queryRunner.query(`ALTER TABLE "incident_events" DROP COLUMN IF EXISTS "outcome"`);
  }
}
