import type { Request } from 'express';

import { withTransaction } from '../database/transaction';
import { getClientIp, getUserAgent } from '../utils/requestContext';
import type { SecurityEventType } from '../utils/observabilityEnums';
import { SecuritySeverity } from '../utils/observabilityEnums';

import { scoreSecurityEvent } from './threat-score.service';
import { createIncidentIfNeeded } from './incident.service';

export interface SecurityEventInput {
  eventType: SecurityEventType | string;
  req?: Request;
  userId?: string | null;
  path?: string | null;
  details?: Record<string, unknown>;
  severity?: SecuritySeverity | string;
}

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    const ip = input.req ? getClientIp(input.req) : null;
    const userAgent = input.req ? getUserAgent(input.req) : null;
    const path = input.path ?? input.req?.path ?? null;
    const isAdminRoute = Boolean(path?.startsWith('/admin') || path?.startsWith('/api/admin'));

    const frequency = await getRecentEventFrequency(input.eventType, ip, 15);
    const severity =
      input.severity ??
      scoreSecurityEvent(input.eventType, {
        frequency,
        isAdminRoute,
        isRepeatOffender: frequency >= 10,
      });

    await withTransaction(async (qr) => {
      await qr.query(
        `INSERT INTO "security_events" ("id","event_type","severity","user_id","ip_address","user_agent","path","details","created_at")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          input.eventType,
          severity,
          input.userId ?? null,
          ip,
          userAgent,
          path,
          JSON.stringify({ ...input.details, frequency }),
        ],
      );
    });

    if (severity === SecuritySeverity.CRITICAL) {
      await createIncidentIfNeeded({
        source: 'security_critical_threat',
        title: `Critical security event: ${input.eventType}`,
        severity: 'critical',
        details: { eventType: input.eventType, path, ip },
      });
    }
  } catch (err) {
    // Observability must never break business flows
    // eslint-disable-next-line no-console
    console.error('[securityEvent] failed to record event:', err);
  }
}

async function getRecentEventFrequency(
  eventType: string,
  ip: string | null,
  windowMinutes: number,
): Promise<number> {
  return withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT COUNT(*) AS cnt FROM "security_events"
       WHERE "event_type" = $1
         AND ($2::inet IS NULL OR "ip_address" = $2::inet)
         AND "created_at" >= NOW() - ($3 || ' minutes')::interval`,
      [eventType, ip, String(windowMinutes)],
    )) as Array<{ cnt: string }>;
    return parseInt(rows[0]?.cnt ?? '0', 10);
  });
}

export async function getThreatMetrics(baselineFrom: string, baselineTo: string, currentFrom: string, to: string) {
  return withTransaction(async (qr) => {
    const actionableTypes = [
      'webhook_invalid_signature',
      'webhook_replay',
      'webhook_malformed',
      'account_locked',
      'permission_denied',
      'unauthorized_admin',
      'rate_limited',
      'otp_rate_limited',
      'forbidden',
    ];

    const countEvents = async (from: string, end: string) => {
      const rows = (await qr.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE severity = 'CRITICAL') AS critical,
           COUNT(*) FILTER (WHERE severity = 'HIGH') AS high,
           COUNT(*) FILTER (WHERE severity = 'MEDIUM') AS medium,
           COUNT(*) FILTER (WHERE severity = 'LOW') AS low,
           COUNT(*) FILTER (WHERE event_type = ANY($3::text[])) AS actionable
         FROM "security_events"
         WHERE "created_at" BETWEEN $1::timestamptz AND $2::timestamptz`,
        [from, end, actionableTypes],
      )) as Array<Record<string, string>>;
      return rows[0];
    };

    const byType = (await qr.query(
      `SELECT "event_type", COUNT(*) AS count
       FROM "security_events"
       WHERE "created_at" BETWEEN $1::timestamptz AND $2::timestamptz
       GROUP BY "event_type"
       ORDER BY count DESC`,
      [currentFrom, to],
    )) as Array<{ event_type: string; count: string }>;

    const baseline = await countEvents(baselineFrom, baselineTo);
    const current = await countEvents(currentFrom, to);

    const baselineHigh = parseInt(baseline.high ?? '0', 10) + parseInt(baseline.critical ?? '0', 10);
    const currentHigh = parseInt(current.high ?? '0', 10) + parseInt(current.critical ?? '0', 10);
    const baselineTotal = parseInt(baseline.total ?? '0', 10) || 1;
    const currentTotal = parseInt(current.total ?? '0', 10) || 1;
    const baselineActionable = parseInt(baseline.actionable ?? '0', 10);
    const currentActionable = parseInt(current.actionable ?? '0', 10);

    const baselineRate = baselineHigh / baselineTotal;
    const currentRate = currentHigh / currentTotal;
    const baselineSignal = baselineActionable / baselineTotal;
    const currentSignal = currentActionable / currentTotal;

    // Factual high-severity share change (can rise when detection visibility improves).
    const highSeverityShareDeltaPct =
      baselineRate > 0
        ? parseFloat((((currentRate - baselineRate) / baselineRate) * 100).toFixed(2))
        : 0;

    // Positive = larger share of actionable/structured signals (architecture maturity).
    const improvementPct =
      baselineSignal > 0
        ? parseFloat((((currentSignal - baselineSignal) / baselineSignal) * 100).toFixed(2))
        : currentSignal > 0
          ? 100
          : 0;

    return {
      baseline: {
        from: baselineFrom,
        to: baselineTo,
        total: parseInt(baseline.total ?? '0', 10),
        high_severity: baselineHigh,
        detection_rate: parseFloat((baselineRate * 100).toFixed(2)),
        actionable_share_pct: parseFloat((baselineSignal * 100).toFixed(2)),
      },
      current: {
        from: currentFrom,
        to,
        total: parseInt(current.total ?? '0', 10),
        high_severity: currentHigh,
        detection_rate: parseFloat((currentRate * 100).toFixed(2)),
        actionable_share_pct: parseFloat((currentSignal * 100).toFixed(2)),
      },
      /** Relative change in actionable-event share. Positive = better signal quality. */
      improvement_pct: improvementPct,
      /** Relative change in HIGH+CRITICAL share. Not “attacks got worse.” */
      high_severity_share_delta_pct: highSeverityShareDeltaPct,
      improvement_definition:
        'Relative change in share of actionable event types (webhook/IAM/lockout/rate-limit). Positive means a more structured detection mix.',
      by_type: byType.map((r) => ({ event_type: r.event_type, count: parseInt(r.count, 10) })),
    };
  });
}
