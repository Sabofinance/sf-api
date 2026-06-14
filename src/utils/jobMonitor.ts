import { withTransaction } from '../database/transaction';
import {
  HeartbeatStatus,
  ReliabilityComponent,
  ReliabilityEventType,
  ReliabilitySeverity,
} from '../utils/observabilityEnums';

import { createReliabilityEvent, recordHeartbeat } from '../services/reliability.service';

export async function runMonitoredJob(
  component: ReliabilityComponent,
  jobName: string,
  fn: () => Promise<void>,
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const latencyMs = Date.now() - start;
    await recordHeartbeat({
      component,
      status: HeartbeatStatus.ok,
      latencyMs,
      metadata: { job: jobName },
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await recordHeartbeat({
      component,
      status: HeartbeatStatus.failed,
      latencyMs,
      metadata: { job: jobName, error: errorMessage },
    });
    await createReliabilityEvent({
      severity: ReliabilitySeverity.warning,
      eventType: ReliabilityEventType.job_failure,
      component,
      details: { job: jobName, error: errorMessage },
    });
    throw err;
  }
}
