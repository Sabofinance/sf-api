export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || process.env.NODE_ENV === 'test') return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/node') as {
      init: (opts: Record<string, unknown>) => void;
    };
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    });
    // eslint-disable-next-line no-console
    console.log('[sentry] initialized');
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[sentry] @sentry/node not installed — skipping APM integration');
  }
}

export function captureException(err: unknown): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || process.env.NODE_ENV === 'test') return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/node') as { captureException: (e: unknown) => void };
    Sentry.captureException(err);
  } catch {
    // ignore
  }
}
