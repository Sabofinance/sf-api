import type { QueryRunner } from 'typeorm';

export type CompanyRateRecord = {
  id: string;
  currency: string;
  rate_ngn: string;
  created_at: string;
  updated_at: string;
};

export class CompanyRateRepository {
  public static async findAll(qr: QueryRunner): Promise<CompanyRateRecord[]> {
    return qr.query(
      `SELECT "id", "currency", "rate_ngn", "created_at", "updated_at"
       FROM "company_rates"
       ORDER BY "currency" ASC`,
    );
  }

  public static async findByCurrency(qr: QueryRunner, currency: string): Promise<CompanyRateRecord | undefined> {
    const rows = (await qr.query(
      `SELECT "id", "currency", "rate_ngn", "created_at", "updated_at"
       FROM "company_rates"
       WHERE "currency" = $1
       LIMIT 1`,
      [currency],
    )) as CompanyRateRecord[];

    return rows[0];
  }

  public static async upsertRate(qr: QueryRunner, currency: string, rate_ngn: string): Promise<CompanyRateRecord> {
    const rows = (await qr.query(
      `INSERT INTO "company_rates" ("id", "currency", "rate_ngn", "created_at", "updated_at")
       VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
       ON CONFLICT ("currency")
       DO UPDATE SET "rate_ngn" = EXCLUDED."rate_ngn", "updated_at" = NOW()
       RETURNING "id", "currency", "rate_ngn", "created_at", "updated_at"`,
      [currency, rate_ngn],
    )) as CompanyRateRecord[];

    return rows[0];
  }
}
