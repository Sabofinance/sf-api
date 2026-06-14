import { withTransaction } from '../database/transaction';
import { IncidentSource, IncidentStatus } from '../utils/observabilityEnums';

export interface CreateIncidentInput {
  source: string;
  title: string;
  severity: string;
  details?: Record<string, unknown>;
  assignedTo?: string | null;
}

export async function createIncidentIfNeeded(input: CreateIncidentInput): Promise<string | null> {
  return withTransaction(async (qr) => {
    const existing = (await qr.query(
      `SELECT "id" FROM "incident_events" WHERE "source" = $1 AND "status" = $2 LIMIT 1`,
      [input.source, IncidentStatus.open],
    )) as Array<{ id: string }>;

    if (existing[0]) return existing[0].id;

    const rows = (await qr.query(
      `INSERT INTO "incident_events" ("id","title","severity","source","status","assigned_to","details","created_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())
       RETURNING "id"`,
      [
        input.title,
        input.severity,
        input.source,
        IncidentStatus.open,
        input.assignedTo ?? null,
        JSON.stringify(input.details ?? {}),
      ],
    )) as Array<{ id: string }>;

    return rows[0].id;
  });
}

export async function resolveIncidentBySource(
  source: string,
  resolutionNotes?: string,
): Promise<number> {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `UPDATE "incident_events"
       SET "status" = $1, "resolved_at" = NOW(), "resolution_notes" = COALESCE($2, "resolution_notes")
       WHERE "source" = $3 AND "status" = $4
       RETURNING "id"`,
      [IncidentStatus.resolved, resolutionNotes ?? null, source, IncidentStatus.open],
    )) as Array<{ id: string }>;
    return rows.length;
  });
}

export async function getOpenIncidentCount(): Promise<number> {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT COUNT(*) AS cnt FROM "incident_events" WHERE "status" = $1`,
      [IncidentStatus.open],
    )) as Array<{ cnt: string }>;
    return parseInt(rows[0]?.cnt ?? '0', 10);
  });
}

export async function listIncidents(limit = 50, offset = 0) {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","title","severity","source","status","assigned_to","resolution_notes","details","created_at","resolved_at"
       FROM "incident_events"
       ORDER BY "created_at" DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    )) as Array<Record<string, unknown>>;
    return rows;
  });
}

export { IncidentSource };
