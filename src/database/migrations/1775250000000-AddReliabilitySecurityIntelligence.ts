import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReliabilitySecurityIntelligence1775250000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reliability_heartbeats" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "component" varchar(64) NOT NULL,
        "status" varchar(16) NOT NULL,
        "latency_ms" int,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_reliability_heartbeats_component_created" ON "reliability_heartbeats" ("component", "created_at" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "reliability_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "severity" varchar(16) NOT NULL,
        "event_type" varchar(64) NOT NULL,
        "component" varchar(64) NOT NULL,
        "details" jsonb NOT NULL DEFAULT '{}',
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_reliability_events_type_created" ON "reliability_events" ("event_type", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reliability_events_unresolved" ON "reliability_events" ("created_at" DESC) WHERE "resolved_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "security_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_type" varchar(64) NOT NULL,
        "severity" varchar(16) NOT NULL,
        "user_id" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
        "ip_address" inet,
        "user_agent" text,
        "path" varchar(512),
        "details" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_security_events_type_created" ON "security_events" ("event_type", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_security_events_severity_created" ON "security_events" ("severity", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_security_events_user_created" ON "security_events" ("user_id", "created_at" DESC) WHERE "user_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "incident_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" varchar(256) NOT NULL,
        "severity" varchar(16) NOT NULL,
        "source" varchar(64) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "assigned_to" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
        "resolution_notes" text,
        "details" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_events_status_created" ON "incident_events" ("status", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_incident_events_open_source" ON "incident_events" ("source") WHERE "status" = 'open'`,
    );

    await queryRunner.query(`
      CREATE TABLE "api_request_metrics" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "endpoint" varchar(512) NOT NULL,
        "method" varchar(8) NOT NULL,
        "status_code" int NOT NULL,
        "response_time_ms" int NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_api_request_metrics_endpoint_created" ON "api_request_metrics" ("endpoint", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_api_request_metrics_status_created" ON "api_request_metrics" ("status_code", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "api_request_metrics"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "incident_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reliability_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reliability_heartbeats"`);
  }
}
