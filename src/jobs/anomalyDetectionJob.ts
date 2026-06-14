import { observabilityConfig } from '../config/observability';
import { runAnomalyDetectionCycle } from '../services/anomaly-detector.service';
import { purgeOldApiMetrics } from '../services/reliability.service';
import { flushPendingMetrics } from '../middleware/requestMetricsMiddleware';

export function startAnomalyDetectionJob(): void {
  const intervalMs = observabilityConfig.anomalyDetectionIntervalMs;

  setInterval(() => {
    runAnomalyDetectionCycle().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[anomalyDetectionJob] error:', err);
    });
  }, intervalMs);

  runAnomalyDetectionCycle().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[anomalyDetectionJob] initial run error:', err);
  });
}

export function startApiMetricsMaintenanceJob(): void {
  setInterval(() => {
    flushPendingMetrics().catch(() => undefined);
    purgeOldApiMetrics().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[apiMetricsMaintenance] purge error:', err);
    });
  }, observabilityConfig.api.metricsFlushIntervalMs);
}
