import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes data integrity: any user whose kyc_status = 'verified' on the users table
 * must have a corresponding kyc record with status = 'verified'.
 *
 * Two cases handled:
 *   1. User has an existing kyc record (pending/rejected) but user.kyc_status is
 *      already 'verified' — most recent record is updated to 'verified'.
 *   2. User has no kyc record at all but user.kyc_status is 'verified' — a
 *      backfill record is inserted so audit trail is consistent.
 */
export class BackfillKycForVerifiedUsers1775220000000 implements MigrationInterface {
  name = 'BackfillKycForVerifiedUsers1775220000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Case 1: user has a kyc record, but none with status='verified'.
    // Update the most recent one to 'verified'.
    await queryRunner.query(`
      UPDATE "kyc"
      SET
        "status"      = 'verified',
        "reviewed_at" = COALESCE("reviewed_at", NOW())
      WHERE "id" IN (
        SELECT DISTINCT ON (k.user_id) k.id
        FROM "kyc" k
        JOIN "users" u ON u.id = k.user_id
        WHERE u.kyc_status = 'verified'
          AND u.role = 'user'
          AND u.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "kyc" k2
            WHERE k2.user_id = k.user_id
              AND k2.status = 'verified'
          )
        ORDER BY k.user_id, k.created_at DESC
      )
    `);

    // Case 2: user has NO kyc record at all. Insert a backfill record.
    // reviewed_at is intentionally NULL — these records have no real review
    // timestamp and must not pollute avg/median verification time calculations.
    await queryRunner.query(`
      INSERT INTO "kyc"
        ("id", "user_id", "document_type", "document_url", "selfie_url",
         "status", "rejection_reason", "reviewed_by", "reviewed_at", "created_at")
      SELECT
        gen_random_uuid(),
        u.id,
        'backfilled',
        'backfilled',
        'backfilled',
        'verified',
        NULL,
        NULL,
        NULL,
        u.created_at
      FROM "users" u
      WHERE u.kyc_status = 'verified'
        AND u.role = 'user'
        AND u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "kyc" k WHERE k.user_id = u.id
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove backfilled placeholder records
    await queryRunner.query(`
      DELETE FROM "kyc"
      WHERE "document_type" = 'backfilled'
    `);

    // Reverting Case 1 is not safe — we cannot know which status the record
    // had before. The up() migration is intentionally not fully reversible.
  }
}
