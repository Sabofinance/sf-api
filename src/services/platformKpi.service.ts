import { withTransaction } from '../database/transaction';
import { calculateUptime } from './reliability.service';
import { getThreatMetrics } from './securityEvent.service';

/** Canonical KPI definitions — keep in sync with admin security API docs when changing. */
export const PLATFORM_KPI_DEFINITIONS = {
  uptime_30d_pct:
    'Share of reliability_heartbeats in the window whose status is ok (component availability). Not wall-clock hosting SLA.',
  transaction_success_pct:
    'completed / terminal across deposits + withdrawals + trades in the same window (existing reliability uptime helper).',
  detection_improvement_pct:
    'Preferred: relative change in disposition precision = confirmed / (confirmed + false_positive) between baseline and current windows. Fallback: relative change in high-severity event share (HIGH+CRITICAL)/total when dispositions are sparse.',
  intrusions_neutralized:
    'Count of incident_events with severity=critical, status=resolved, outcome=neutralized, and resolved_at inside the current window.',
  vulnerability_gaps_closed:
    'Count of security_control_closures with closed_at on or before the window end (cumulative auditable control register).',
} as const;

export interface PlatformKpiQuery {
  /** End of current window (default now). */
  to?: string;
  /** Start of current window (default 30d before to). */
  currentFrom?: string;
  /** Start of baseline window (default 60d before to; baseline ends at currentFrom). */
  baselineFrom?: string;
  /** Persist a row in platform_kpi_snapshots. */
  persist?: boolean;
  /** Mark snapshot as synthetic (demo seed / non-production). */
  synthetic?: boolean;
}

export interface PlatformKpiResult {
  period: {
    baseline_from: string;
    baseline_to: string;
    current_from: string;
    current_to: string;
  };
  uptime_30d_pct: number;
  transaction_success_pct: number;
  detection_improvement_pct: number;
  detection_method: 'disposition_precision' | 'high_severity_share';
  intrusions_neutralized: number;
  vulnerability_gaps_closed: number;
  definitions: typeof PLATFORM_KPI_DEFINITIONS;
  breakdown: Record<string, unknown>;
  synthetic: boolean;
  generated_at: string;
  snapshot_id?: string;
}

async function heartbeatUptimePct(from: string, to: string): Promise<{
  uptime_pct: number;
  ok: number;
  total: number;
}> {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'ok')::int AS ok
       FROM "reliability_heartbeats"
       WHERE "created_at" BETWEEN $1::timestamptz AND $2::timestamptz`,
      [from, to],
    )) as Array<{ total: number; ok: number }>;
    const total = Number(rows[0]?.total ?? 0);
    const ok = Number(rows[0]?.ok ?? 0);
    return {
      total,
      ok,
      uptime_pct: total > 0 ? parseFloat(((ok / total) * 100).toFixed(4)) : 100,
    };
  });
}

async function dispositionPrecision(
  from: string,
  to: string,
): Promise<{ precision: number; confirmed: number; false_positive: number; labeled: number }> {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT
         COUNT(*) FILTER (WHERE disposition = 'confirmed')::int AS confirmed,
         COUNT(*) FILTER (WHERE disposition = 'false_positive')::int AS false_positive
       FROM "security_events"
       WHERE "created_at" BETWEEN $1::timestamptz AND $2::timestamptz
         AND disposition IN ('confirmed', 'false_positive')`,
      [from, to],
    )) as Array<{ confirmed: number; false_positive: number }>;
    const confirmed = Number(rows[0]?.confirmed ?? 0);
    const falsePositive = Number(rows[0]?.false_positive ?? 0);
    const labeled = confirmed + falsePositive;
    return {
      confirmed,
      false_positive: falsePositive,
      labeled,
      precision: labeled > 0 ? confirmed / labeled : 0,
    };
  });
}

async function countNeutralizedIntrusions(from: string, to: string): Promise<number> {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT COUNT(*)::int AS n
       FROM "incident_events"
       WHERE severity = 'critical'
         AND status = 'resolved'
         AND outcome = 'neutralized'
         AND resolved_at BETWEEN $1::timestamptz AND $2::timestamptz`,
      [from, to],
    )) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  });
}

async function countClosedControls(to: string): Promise<{
  total: number;
  controls: Array<{ control_key: string; title: string; closed_at: Date; evidence_ref: string | null }>;
}> {
  return withTransaction(async (qr) => {
    const controls = (await qr.query(
      `SELECT "control_key","title","closed_at","evidence_ref"
       FROM "security_control_closures"
       WHERE "closed_at" <= $1::timestamptz
       ORDER BY "closed_at" ASC`,
      [to],
    )) as Array<{
      control_key: string;
      title: string;
      closed_at: Date;
      evidence_ref: string | null;
    }>;
    return { total: controls.length, controls };
  });
}

export async function computePlatformKpis(input: PlatformKpiQuery = {}): Promise<PlatformKpiResult> {
  const to = input.to ?? new Date().toISOString();
  const currentFrom =
    input.currentFrom ?? new Date(new Date(to).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const baselineFrom =
    input.baselineFrom ?? new Date(new Date(to).getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const [hb, txn, baselinePrec, currentPrec, neutralized, closures] = await Promise.all([
    heartbeatUptimePct(currentFrom, to),
    calculateUptime(currentFrom, to),
    dispositionPrecision(baselineFrom, currentFrom),
    dispositionPrecision(currentFrom, to),
    countNeutralizedIntrusions(currentFrom, to),
    countClosedControls(to),
  ]);

  let detectionMethod: PlatformKpiResult['detection_method'] = 'disposition_precision';
  let detectionImprovementPct = 0;

  const enoughLabels = baselinePrec.labeled >= 20 && currentPrec.labeled >= 20;
  if (enoughLabels && baselinePrec.precision > 0) {
    detectionImprovementPct = parseFloat(
      (
        ((currentPrec.precision - baselinePrec.precision) / baselinePrec.precision) *
        100
      ).toFixed(4),
    );
  } else {
    detectionMethod = 'high_severity_share';
    const threat = await getThreatMetrics(baselineFrom, currentFrom, currentFrom, to);
    detectionImprovementPct = threat.improvement_pct;
  }

  const generatedAt = new Date().toISOString();
  const synthetic = Boolean(input.synthetic);

  const result: PlatformKpiResult = {
    period: {
      baseline_from: baselineFrom,
      baseline_to: currentFrom,
      current_from: currentFrom,
      current_to: to,
    },
    uptime_30d_pct: hb.uptime_pct,
    transaction_success_pct: txn.uptime_pct,
    detection_improvement_pct: detectionImprovementPct,
    detection_method: detectionMethod,
    intrusions_neutralized: neutralized,
    vulnerability_gaps_closed: closures.total,
    definitions: PLATFORM_KPI_DEFINITIONS,
    breakdown: {
      heartbeats: { ok: hb.ok, total: hb.total },
      transactions: {
        completed: txn.completed_transactions,
        terminal: txn.terminal_transactions,
      },
      detection: {
        baseline: baselinePrec,
        current: currentPrec,
      },
      closed_controls: closures.controls,
    },
    synthetic,
    generated_at: generatedAt,
  };

  if (input.persist) {
    const snapshotId = await withTransaction(async (qr) => {
      const rows = (await qr.query(
        `INSERT INTO "platform_kpi_snapshots"
          ("id","period_from","period_to","uptime_30d_pct","transaction_success_pct",
           "detection_improvement_pct","detection_method","intrusions_neutralized",
           "vulnerability_gaps_closed","definitions","breakdown","synthetic","generated_at")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)
         RETURNING "id"`,
        [
          currentFrom,
          to,
          result.uptime_30d_pct,
          result.transaction_success_pct,
          result.detection_improvement_pct,
          result.detection_method,
          result.intrusions_neutralized,
          result.vulnerability_gaps_closed,
          JSON.stringify(result.definitions),
          JSON.stringify(result.breakdown),
          synthetic,
          generatedAt,
        ],
      )) as Array<{ id: string }>;
      return rows[0].id;
    });
    result.snapshot_id = snapshotId;
  }

  return result;
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function listPlatformKpiSnapshots(limit = 20) {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","period_from","period_to","uptime_30d_pct","transaction_success_pct",
              "detection_improvement_pct","detection_method","intrusions_neutralized",
              "vulnerability_gaps_closed","synthetic","generated_at"
       FROM "platform_kpi_snapshots"
       ORDER BY "generated_at" DESC
       LIMIT $1`,
      [limit],
    )) as Array<Record<string, unknown>>;

    // pg returns numeric(8,4) as strings; coerce so the portal can format percentages.
    return rows.map((row) => ({
      ...row,
      uptime_30d_pct: toNumber(row.uptime_30d_pct),
      transaction_success_pct: toNumber(row.transaction_success_pct),
      detection_improvement_pct: toNumber(row.detection_improvement_pct),
      intrusions_neutralized: toNumber(row.intrusions_neutralized),
      vulnerability_gaps_closed: toNumber(row.vulnerability_gaps_closed),
    }));
  });
}
