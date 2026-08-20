import { observabilityConfig } from '../config/observability';
import { withTransaction } from '../database/transaction';
import {
  HeartbeatStatus,
  ReliabilityComponent,
  ReliabilityEventType,
  ReliabilitySeverity,
} from '../utils/observabilityEnums';

export interface RecordHeartbeatInput {
  component: ReliabilityComponent | string;
  status: HeartbeatStatus | string;
  latencyMs?: number | null;
  metadata?: Record<string, unknown>;
}

export interface CreateReliabilityEventInput {
  severity: ReliabilitySeverity | string;
  eventType: ReliabilityEventType | string;
  component: ReliabilityComponent | string;
  details?: Record<string, unknown>;
}

export async function recordHeartbeat(input: RecordHeartbeatInput): Promise<void> {
  await withTransaction(async (qr) => {
    await qr.query(
      `INSERT INTO "reliability_heartbeats" ("id","component","status","latency_ms","metadata","created_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
      [input.component, input.status, input.latencyMs ?? null, JSON.stringify(input.metadata ?? {})],
    );
  });
}

export async function createReliabilityEvent(input: CreateReliabilityEventInput): Promise<string> {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `INSERT INTO "reliability_events" ("id","severity","event_type","component","details","created_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
       RETURNING "id"`,
      [input.severity, input.eventType, input.component, JSON.stringify(input.details ?? {})],
    )) as Array<{ id: string }>;
    return rows[0].id;
  });
}

export async function resolveReliabilityEventsByType(
  eventType: string,
  component: string,
): Promise<number> {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `UPDATE "reliability_events"
       SET "resolved_at" = NOW()
       WHERE "event_type" = $1 AND "component" = $2 AND "resolved_at" IS NULL
       RETURNING "id"`,
      [eventType, component],
    )) as Array<{ id: string }>;
    return rows.length;
  });
}

export async function getLatestHeartbeat(component: string) {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","component","status","latency_ms","metadata","created_at"
       FROM "reliability_heartbeats"
       WHERE "component" = $1
       ORDER BY "created_at" DESC
       LIMIT 1`,
      [component],
    )) as Array<{
      id: string;
      component: string;
      status: string;
      latency_ms: number | null;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>;
    return rows[0] ?? null;
  });
}

export async function getComponentStatus(component: string) {
  const latest = await getLatestHeartbeat(component);
  if (!latest) {
    return { component, status: HeartbeatStatus.failed, lastSeen: null, latencyMs: null, metadata: {} };
  }

  const ageMinutes = (Date.now() - new Date(latest.created_at).getTime()) / 60000;
  const missedThreshold = observabilityConfig.heartbeatMissingThresholdMinutes;

  let status = latest.status;
  if (ageMinutes > missedThreshold) {
    status = HeartbeatStatus.failed;
  } else if (latest.status === HeartbeatStatus.failed) {
    status = HeartbeatStatus.degraded;
  }

  return {
    component,
    status,
    lastSeen: latest.created_at,
    latencyMs: latest.latency_ms,
    metadata: latest.metadata,
    ageMinutes: parseFloat(ageMinutes.toFixed(2)),
  };
}

export async function calculateUptime(from: string, to: string) {
  return withTransaction(async (qr) => {
    const [txnRow] = (await qr.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) FILTER (WHERE status IN ('completed','failed','rejected','expired','cancelled')) AS terminal
       FROM (
         SELECT status::text AS status FROM "deposits" WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
         UNION ALL
         SELECT status::text FROM "withdrawals" WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
         UNION ALL
         SELECT status::text FROM "trades" WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
       ) t`,
      [from, to],
    )) as Array<{ completed: string; terminal: string }>;

    const completed = parseInt(txnRow?.completed ?? '0', 10);
    const terminal = parseInt(txnRow?.terminal ?? '0', 10);
    const uptimePct = terminal > 0 ? parseFloat(((completed / terminal) * 100).toFixed(4)) : 100;

    const dailyRows = (await qr.query(
      `SELECT
         DATE_TRUNC('day', bucket)::date AS day,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) AS total
       FROM (
         SELECT created_at AS bucket, status::text AS status FROM "deposits" WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
         UNION ALL
         SELECT created_at, status::text FROM "withdrawals" WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
         UNION ALL
         SELECT created_at, status::text FROM "trades" WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
       ) t
       GROUP BY DATE_TRUNC('day', bucket)
       ORDER BY day ASC`,
      [from, to],
    )) as Array<{ day: string; completed: string; total: string }>;

    return {
      uptime_pct: uptimePct,
      completed_transactions: completed,
      terminal_transactions: terminal,
      daily: dailyRows.map((r) => ({
        day: r.day,
        uptime_pct: parseInt(r.total, 10) > 0
          ? parseFloat(((parseInt(r.completed, 10) / parseInt(r.total, 10)) * 100).toFixed(4))
          : 100,
        completed: parseInt(r.completed, 10),
        total: parseInt(r.total, 10),
      })),
    };
  });
}

export async function recordApiMetric(
  endpoint: string,
  method: string,
  statusCode: number,
  responseTimeMs: number,
): Promise<void> {
  await withTransaction(async (qr) => {
    await qr.query(
      `INSERT INTO "api_request_metrics" ("id","endpoint","method","status_code","response_time_ms","created_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
      [endpoint, method, statusCode, responseTimeMs],
    );
  });
}

export async function purgeOldApiMetrics(): Promise<number> {
  const days = observabilityConfig.api.metricsRetentionDays;
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `DELETE FROM "api_request_metrics"
       WHERE "created_at" < NOW() - ($1 || ' days')::interval
       RETURNING "id"`,
      [String(days)],
    )) as Array<{ id: string }>;
    return rows.length;
  });
}
