import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotifications1760000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create the custom types (enums)
    await queryRunner.query(`CREATE TYPE "notification_status_enum" AS ENUM ('unread', 'read')`);
    await queryRunner.query(`CREATE TYPE "notification_type_enum" AS ENUM ('info', 'success', 'warning', 'error')`);

    // 2. Create the notifications table
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "title" varchar(255) NOT NULL,
        "message" text NOT NULL,
        "type" "notification_type_enum" NOT NULL DEFAULT 'info',
        "status" "notification_status_enum" NOT NULL DEFAULT 'unread',
        "related_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 3. Add indexes for performance
    await queryRunner.query(`CREATE INDEX "IDX_notifications_user" ON "notifications" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_notifications_created_at" ON "notifications" ("created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_notifications_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_notifications_user"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "notification_type_enum"`);
    await queryRunner.query(`DROP TYPE "notification_status_enum"`);
  }
}