export const observabilityConfig = {
  fx: {
    staleThresholdMinutes: parseInt(process.env.FX_STALE_THRESHOLD_MINUTES ?? '30', 10),
    spikeThresholdPct: parseFloat(process.env.FX_SPIKE_THRESHOLD_PCT ?? '5'),
  },
  jobs: {
    missedThresholdMinutes: parseInt(process.env.JOB_MISSED_THRESHOLD_MINUTES ?? '30', 10),
    slowExecutionMs: parseInt(process.env.JOB_SLOW_THRESHOLD_MS ?? '30000', 10),
    fxSyncFailureIncidentThreshold: parseInt(process.env.FX_SYNC_FAILURE_INCIDENT_THRESHOLD ?? '3', 10),
  },
  api: {
    latencyWarningMs: parseInt(process.env.API_LATENCY_WARNING_MS ?? '1000', 10),
    latencyCriticalMs: parseInt(process.env.API_LATENCY_CRITICAL_MS ?? '3000', 10),
    errorSpikeWindowMinutes: parseInt(process.env.API_ERROR_SPIKE_WINDOW_MINUTES ?? '15', 10),
    errorSpikeThreshold: parseInt(process.env.API_ERROR_SPIKE_THRESHOLD ?? '20', 10),
    metricsRetentionDays: parseInt(process.env.API_METRICS_RETENTION_DAYS ?? '7', 10),
    metricsFlushIntervalMs: parseInt(process.env.API_METRICS_FLUSH_INTERVAL_MS ?? '10000', 10),
  },
  transactions: {
    failureSpikeWindowMinutes: parseInt(process.env.TXN_FAILURE_SPIKE_WINDOW_MINUTES ?? '60', 10),
    failureSpikeThresholdPct: parseFloat(process.env.TXN_FAILURE_SPIKE_THRESHOLD_PCT ?? '10'),
  },
  anomalyDetectionIntervalMs: parseInt(process.env.ANOMALY_DETECTION_INTERVAL_MS ?? '300000', 10),
  heartbeatMissingThresholdMinutes: parseInt(process.env.HEARTBEAT_MISSING_THRESHOLD_MINUTES ?? '30', 10),
  criticalEndpoints: [
    '/auth/login',
    '/auth/verify-otp',
    '/withdrawals',
    '/deposits',
    '/admin/kyc',
    '/admin/deposits',
    '/admin/withdrawals',
  ],
} as const;
