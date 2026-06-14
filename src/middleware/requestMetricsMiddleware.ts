import type { NextFunction, Request, Response } from 'express';

import { checkEndpointLatency } from '../services/anomaly-detector.service';
import { recordApiMetric } from '../services/reliability.service';
import { normalizeEndpoint } from '../utils/requestContext';

const pendingMetrics: Array<{
  endpoint: string;
  method: string;
  statusCode: number;
  responseTimeMs: number;
}> = [];

let flushTimer: ReturnType<typeof setInterval> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushMetrics();
  }, 10000);
}

async function flushMetrics(): Promise<void> {
  if (pendingMetrics.length === 0) return;
  const batch = pendingMetrics.splice(0, pendingMetrics.length);
  for (const metric of batch) {
    try {
      await recordApiMetric(
        metric.endpoint,
        metric.method,
        metric.statusCode,
        metric.responseTimeMs,
      );
    } catch {
      // ignore flush errors
    }
  }
}

export function requestMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    next();
    return;
  }

  const start = Date.now();
  scheduleFlush();

  res.on('finish', () => {
    const responseTimeMs = Date.now() - start;
    const endpoint = normalizeEndpoint(req.path);
    const method = req.method.toUpperCase();

    pendingMetrics.push({
      endpoint,
      method,
      statusCode: res.statusCode,
      responseTimeMs,
    });

    void checkEndpointLatency(endpoint, method, responseTimeMs);
  });

  next();
}

export async function flushPendingMetrics(): Promise<void> {
  await flushMetrics();
}
