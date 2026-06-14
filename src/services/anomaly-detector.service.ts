import { observabilityConfig } from '../config/observability';
import { AppDataSource } from '../database/data-source';
import { withTransaction } from '../database/transaction';
import {
  HeartbeatStatus,
  IncidentSource,
  ReliabilityComponent,
  ReliabilityEventType,
  ReliabilitySeverity,
} from '../utils/observabilityEnums';

import { createIncidentIfNeeded, resolveIncidentBySource } from './incident.service';
import {
  createReliabilityEvent,
  getComponentStatus,
  getLatestHeartbeat,
  recordHeartbeat,
  resolveReliabilityEventsByType,
} from './reliability.service';

let fxConsecutiveFailures = 0;

export async function runAnomalyDetectionCycle(): Promise<void> {
  await checkDatabaseConnectivity();
  await detectFxAnomalies();
  await detectJobAnomalies();
  await detectTransactionFailureSpikes();
  await detectApiAnomalies();
  await recordApiLayerHeartbeat();
  await detectMissingHeartbeats();
}

async function checkDatabaseConnectivity(): Promise<void> {
  const start = Date.now();
  try {
    await AppDataSource.query('SELECT 1');
    await recordHeartbeat({
      component: ReliabilityComponent.database,
      status: HeartbeatStatus.ok,
      latencyMs: Date.now() - start,
      metadata: { check: 'select_1' },
    });
    await resolveIncidentBySource(IncidentSource.database_unavailable, 'Database connectivity restored');
    await resolveReliabilityEventsByType(
      ReliabilityEventType.database_unavailable,
      ReliabilityComponent.database,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await recordHeartbeat({
      component: ReliabilityComponent.database,
      status: HeartbeatStatus.failed,
      latencyMs: Date.now() - start,
      metadata: { error: errorMessage },
    });
    await createReliabilityEvent({
      severity: ReliabilitySeverity.critical,
      eventType: ReliabilityEventType.database_unavailable,
      component: ReliabilityComponent.database,
      details: { error: errorMessage },
    });
    await createIncidentIfNeeded({
      source: IncidentSource.database_unavailable,
      title: 'Database unavailable',
      severity: 'critical',
      details: { error: errorMessage },
    });
  }
}

async function detectFxAnomalies(): Promise<void> {
  const { staleThresholdMinutes, spikeThresholdPct } = observabilityConfig.fx;

  await withTransaction(async (qr) => {
    const latestRows = (await qr.query(
      `SELECT DISTINCT ON ("pair") "pair", "rate", "created_at"
       FROM "exchange_rates"
       ORDER BY "pair", "created_at" DESC`,
    )) as Array<{ pair: string; rate: string; created_at: Date }>;

    if (latestRows.length === 0) return;

    const newest = latestRows.reduce((a, b) =>
      new Date(a.created_at) > new Date(b.created_at) ? a : b,
    );
    const ageMinutes = (Date.now() - new Date(newest.created_at).getTime()) / 60000;

    if (ageMinutes > staleThresholdMinutes) {
      await createReliabilityEvent({
        severity: ReliabilitySeverity.warning,
        eventType: ReliabilityEventType.fx_stale,
        component: ReliabilityComponent.fx_engine,
        details: { ageMinutes: parseFloat(ageMinutes.toFixed(2)), thresholdMinutes: staleThresholdMinutes },
      });
      await createIncidentIfNeeded({
        source: IncidentSource.heartbeat_missing,
        title: 'FX rates stale',
        severity: 'warning',
        details: { ageMinutes },
      });
    } else {
      await resolveReliabilityEventsByType(
        ReliabilityEventType.fx_stale,
        ReliabilityComponent.fx_engine,
      );
    }

    for (const row of latestRows) {
      const [avgRow] = (await qr.query(
        `SELECT AVG(rate::numeric) AS avg_rate
         FROM "exchange_rates"
         WHERE "pair" = $1 AND "created_at" >= NOW() - INTERVAL '24 hours'`,
        [row.pair],
      )) as Array<{ avg_rate: string | null }>;

      const avgRate = avgRow?.avg_rate ? parseFloat(avgRow.avg_rate) : null;
      const currentRate = parseFloat(row.rate);
      if (!avgRate || avgRate <= 0) continue;

      const deviationPct = Math.abs(((currentRate - avgRate) / avgRate) * 100);
      if (deviationPct > spikeThresholdPct) {
        await createReliabilityEvent({
          severity: ReliabilitySeverity.warning,
          eventType: ReliabilityEventType.fx_rate_spike,
          component: ReliabilityComponent.fx_engine,
          details: {
            pair: row.pair,
            currentRate,
            avgRate24h: avgRate,
            deviationPct: parseFloat(deviationPct.toFixed(4)),
            thresholdPct: spikeThresholdPct,
          },
        });
      }
    }
  });
}

export async function recordFxSyncResult(success: boolean, error?: string): Promise<void> {
  if (success) {
    fxConsecutiveFailures = 0;
    await resolveIncidentBySource(
      IncidentSource.fx_sync_consecutive_failure,
      'FX sync recovered',
    );
    await resolveReliabilityEventsByType(
      ReliabilityEventType.fx_sync_failure,
      ReliabilityComponent.fx_engine,
    );
    return;
  }

  fxConsecutiveFailures += 1;
  await createReliabilityEvent({
    severity: ReliabilitySeverity.warning,
    eventType: ReliabilityEventType.fx_sync_failure,
    component: ReliabilityComponent.fx_engine,
    details: { consecutiveFailures: fxConsecutiveFailures, error: error ?? 'unknown' },
  });

  if (fxConsecutiveFailures >= observabilityConfig.jobs.fxSyncFailureIncidentThreshold) {
    await createIncidentIfNeeded({
      source: IncidentSource.fx_sync_consecutive_failure,
      title: `FX sync failed ${fxConsecutiveFailures} consecutive times`,
      severity: 'critical',
      details: { consecutiveFailures: fxConsecutiveFailures, error },
    });
  }
}

async function detectJobAnomalies(): Promise<void> {
  const { missedThresholdMinutes, slowExecutionMs } = observabilityConfig.jobs;
  const latest = await getLatestHeartbeat(ReliabilityComponent.background_jobs);

  if (!latest) {
    await createReliabilityEvent({
      severity: ReliabilitySeverity.warning,
      eventType: ReliabilityEventType.job_missed,
      component: ReliabilityComponent.background_jobs,
      details: { reason: 'no_heartbeat_recorded' },
    });
    return;
  }

  const ageMinutes = (Date.now() - new Date(latest.created_at).getTime()) / 60000;
  if (ageMinutes > missedThresholdMinutes) {
    await createReliabilityEvent({
      severity: ReliabilitySeverity.warning,
      eventType: ReliabilityEventType.job_missed,
      component: ReliabilityComponent.background_jobs,
      details: { ageMinutes, thresholdMinutes: missedThresholdMinutes, lastJob: latest.metadata },
    });
  }

  if (latest.latency_ms !== null && latest.latency_ms > slowExecutionMs) {
    await createReliabilityEvent({
      severity: ReliabilitySeverity.info,
      eventType: ReliabilityEventType.job_slow,
      component: ReliabilityComponent.background_jobs,
      details: { latencyMs: latest.latency_ms, thresholdMs: slowExecutionMs, job: latest.metadata },
    });
  }
}

async function detectTransactionFailureSpikes(): Promise<void> {
  const { failureSpikeWindowMinutes, failureSpikeThresholdPct } = observabilityConfig.transactions;

  await withTransaction(async (qr) => {
    const [row] = (await qr.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('failed','rejected','expired','cancelled','disputed')) AS failures,
         COUNT(*) AS total
       FROM (
         SELECT status::text AS status FROM "deposits"
           WHERE created_at >= NOW() - ($1 || ' minutes')::interval
         UNION ALL
         SELECT status::text FROM "withdrawals"
           WHERE created_at >= NOW() - ($1 || ' minutes')::interval
         UNION ALL
         SELECT status::text FROM "trades"
           WHERE created_at >= NOW() - ($1 || ' minutes')::interval
       ) t`,
      [String(failureSpikeWindowMinutes)],
    )) as Array<{ failures: string; total: string }>;

    const failures = parseInt(row?.failures ?? '0', 10);
    const total = parseInt(row?.total ?? '0', 10);
    if (total < 10) return;

    const failurePct = (failures / total) * 100;
    if (failurePct >= failureSpikeThresholdPct) {
      await createReliabilityEvent({
        severity: ReliabilitySeverity.warning,
        eventType: ReliabilityEventType.transaction_failure_spike,
        component: ReliabilityComponent.api,
        details: {
          failures,
          total,
          failurePct: parseFloat(failurePct.toFixed(2)),
          windowMinutes: failureSpikeWindowMinutes,
        },
      });
    }
  });
}

async function detectApiAnomalies(): Promise<void> {
  const { errorSpikeWindowMinutes, errorSpikeThreshold, latencyWarningMs, latencyCriticalMs } =
    observabilityConfig.api;

  await withTransaction(async (qr) => {
    const [errorRow] = (await qr.query(
      `SELECT
         COUNT(*) FILTER (WHERE status_code >= 500) AS errors_5xx,
         COUNT(*) AS total
       FROM "api_request_metrics"
       WHERE "created_at" >= NOW() - ($1 || ' minutes')::interval`,
      [String(errorSpikeWindowMinutes)],
    )) as Array<{ errors_5xx: string; total: string }>;

    const errors5xx = parseInt(errorRow?.errors_5xx ?? '0', 10);
    if (errors5xx >= errorSpikeThreshold) {
      await createReliabilityEvent({
        severity: ReliabilitySeverity.critical,
        eventType: ReliabilityEventType.api_error_spike,
        component: ReliabilityComponent.api,
        details: { errors5xx, windowMinutes: errorSpikeWindowMinutes, threshold: errorSpikeThreshold },
      });
      await createIncidentIfNeeded({
        source: IncidentSource.api_error_spike,
        title: `API 5xx spike: ${errors5xx} errors in ${errorSpikeWindowMinutes}m`,
        severity: 'critical',
        details: { errors5xx },
      });
    } else {
      await resolveIncidentBySource(IncidentSource.api_error_spike, 'API error rate normalized');
    }

    const slowRows = (await qr.query(
      `SELECT "endpoint", "method", PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95
       FROM "api_request_metrics"
       WHERE "created_at" >= NOW() - ($1 || ' minutes')::interval
       GROUP BY "endpoint", "method"
       HAVING PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) > $2
       LIMIT 10`,
      [String(errorSpikeWindowMinutes), latencyWarningMs],
    )) as Array<{ endpoint: string; method: string; p95: string }>;

    for (const slow of slowRows) {
      const p95 = parseFloat(slow.p95);
      await createReliabilityEvent({
        severity: p95 >= latencyCriticalMs ? ReliabilitySeverity.critical : ReliabilitySeverity.warning,
        eventType: ReliabilityEventType.api_latency,
        component: ReliabilityComponent.api,
        details: {
          endpoint: slow.endpoint,
          method: slow.method,
          p95Ms: p95,
          warningMs: latencyWarningMs,
          criticalMs: latencyCriticalMs,
        },
      });
    }
  });
}

async function detectMissingHeartbeats(): Promise<void> {
  const components = Object.values(ReliabilityComponent);
  for (const component of components) {
    const status = await getComponentStatus(component);
    if (status.status === HeartbeatStatus.failed && status.lastSeen) {
      await createIncidentIfNeeded({
        source: `${IncidentSource.heartbeat_missing}:${component}`,
        title: `Missing heartbeat: ${component}`,
        severity: 'warning',
        details: { component, ageMinutes: status.ageMinutes },
      });
    } else if (status.status === HeartbeatStatus.ok) {
      await resolveIncidentBySource(`${IncidentSource.heartbeat_missing}:${component}`);
    }
  }
}

async function recordApiLayerHeartbeat(): Promise<void> {
  await withTransaction(async (qr) => {
    const [row] = (await qr.query(
      `SELECT COUNT(*) AS cnt, AVG(response_time_ms)::int AS avg_ms
       FROM "api_request_metrics"
       WHERE "created_at" >= NOW() - INTERVAL '5 minutes'`,
    )) as Array<{ cnt: string; avg_ms: number | null }>;

    const cnt = parseInt(row?.cnt ?? '0', 10);
    if (cnt === 0) return;

    await recordHeartbeat({
      component: ReliabilityComponent.api,
      status: HeartbeatStatus.ok,
      latencyMs: row?.avg_ms ?? null,
      metadata: { requests5m: cnt },
    });
  });
}

export async function checkEndpointLatency(
  endpoint: string,
  method: string,
  responseTimeMs: number,
): Promise<void> {
  const { latencyWarningMs, latencyCriticalMs } = observabilityConfig.api;
  if (responseTimeMs < latencyWarningMs) return;

  await createReliabilityEvent({
    severity: responseTimeMs >= latencyCriticalMs ? ReliabilitySeverity.critical : ReliabilitySeverity.warning,
    eventType: ReliabilityEventType.api_latency,
    component: ReliabilityComponent.api,
    details: { endpoint, method, responseTimeMs, warningMs: latencyWarningMs, criticalMs: latencyCriticalMs },
  });
}
