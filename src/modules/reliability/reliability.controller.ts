import type { Request, Response } from 'express';
import { z } from 'zod';

import { observabilityConfig } from '../../config/observability';
import { AppDataSource } from '../../database/data-source';
import { withTransaction } from '../../database/transaction';
import {
  calculateUptime,
  getComponentStatus,
  getLatestHeartbeat,
} from '../../services/reliability.service';
import { getOpenIncidentCount, listIncidents } from '../../services/incident.service';
import {
  HeartbeatStatus,
  ReliabilityComponent,
} from '../../utils/observabilityEnums';
import { ok } from '../../utils/apiResponse';

const eventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unresolved: z.enum(['true', 'false']).optional(),
});

const uptimeQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export async function getReliabilitySummary(_req: Request, res: Response) {
  const components = await Promise.all(
    Object.values(ReliabilityComponent).map((c) => getComponentStatus(c)),
  );

  const fxLatest = await getLatestHeartbeat(ReliabilityComponent.fx_engine);
  const openIncidents = await getOpenIncidentCount();

  const windowTo = new Date().toISOString();
  const windowFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const uptime = await calculateUptime(windowFrom, windowTo);

  const overallStatus = components.some((c) => c.status === HeartbeatStatus.failed)
    ? 'critical'
    : components.some((c) => c.status === HeartbeatStatus.degraded)
      ? 'degraded'
      : 'healthy';

  return ok(res, {
    overall_status: overallStatus,
    uptime_30d_pct: uptime.uptime_pct,
    open_incidents: openIncidents,
    components,
    fx_sync: {
      last_sync: fxLatest?.created_at ?? null,
      status: fxLatest?.status ?? 'unknown',
      latency_ms: fxLatest?.latency_ms ?? null,
    },
    generated_at: new Date().toISOString(),
  });
}

export async function listReliabilityEvents(req: Request, res: Response) {
  const query = eventsQuerySchema.parse(req.query);
  const offset = (query.page - 1) * query.limit;

  const result = await withTransaction(async (qr) => {
    let where = '';
    const params: unknown[] = [];
    if (query.unresolved === 'true') {
      where = 'WHERE "resolved_at" IS NULL';
    }

    const events = (await qr.query(
      `SELECT "id","severity","event_type","component","details","resolved_at","created_at"
       FROM "reliability_events"
       ${where}
       ORDER BY "created_at" DESC
       LIMIT $1 OFFSET $2`,
      [query.limit, offset],
    )) as Array<Record<string, unknown>>;

    const incidents = await listIncidents(query.limit, offset);

    return { events, incidents };
  });

  return ok(res, {
    events: result.events,
    incidents: result.incidents,
    page: query.page,
    limit: query.limit,
  });
}

export async function getReliabilityUptime(req: Request, res: Response) {
  const query = uptimeQuerySchema.parse(req.query);
  const to = query.to ?? new Date().toISOString();
  const from = query.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const uptime = await calculateUptime(from, to);

  return ok(res, {
    from,
    to,
    sla: {
      uptime_pct: uptime.uptime_pct,
      completed_transactions: uptime.completed_transactions,
      terminal_transactions: uptime.terminal_transactions,
    },
    daily: uptime.daily,
    generated_at: new Date().toISOString(),
  });
}

export async function getDeepHealth(_req: Request, res: Response) {
  const components = await Promise.all(
    Object.values(ReliabilityComponent).map((c) => getComponentStatus(c)),
  );

  let dbOk = false;
  let dbLatencyMs: number | null = null;
  const dbStart = Date.now();
  try {
    await AppDataSource.query('SELECT 1');
    dbOk = true;
    dbLatencyMs = Date.now() - dbStart;
  } catch {
    dbOk = false;
    dbLatencyMs = Date.now() - dbStart;
  }

  const fxFreshness = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT MAX("created_at") AS latest FROM "exchange_rates"`,
    )) as Array<{ latest: Date | null }>;
    return rows[0]?.latest ?? null;
  });

  const fxAgeMinutes = fxFreshness
    ? (Date.now() - new Date(fxFreshness).getTime()) / 60000
    : null;

  const critical = !dbOk || components.some((c) => c.status === HeartbeatStatus.failed);
  const degraded =
    !critical &&
    (components.some((c) => c.status === HeartbeatStatus.degraded) ||
      (fxAgeMinutes !== null && fxAgeMinutes > observabilityConfig.fx.staleThresholdMinutes));

  const overallStatus = critical ? 'critical' : degraded ? 'degraded' : 'ok';

  const payload = {
    status: overallStatus,
    checks: {
      database: { ok: dbOk, latency_ms: dbLatencyMs },
      fx_freshness: {
        latest_rate_at: fxFreshness,
        age_minutes: fxAgeMinutes !== null ? parseFloat(fxAgeMinutes.toFixed(2)) : null,
        stale: fxAgeMinutes !== null && fxAgeMinutes > observabilityConfig.fx.staleThresholdMinutes,
      },
      components,
      background_jobs: components.find((c) => c.component === ReliabilityComponent.background_jobs),
      webhook: components.find((c) => c.component === ReliabilityComponent.webhook),
    },
    generated_at: new Date().toISOString(),
  };

  return res.status(critical ? 503 : 200).json({
    success: !critical,
    data: payload,
    meta: {},
    error: critical ? { code: 'SERVICE_DEGRADED', message: 'One or more critical components are unavailable.' } : null,
  });
}
