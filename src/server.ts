import { createApp } from './app';
import { initObservability } from './config/observabilityInit';
import { env } from './config/env';
import { AppDataSource } from './database/data-source';
import { startAnomalyDetectionJob, startApiMetricsMaintenanceJob } from './jobs/anomalyDetectionJob';
import './jobs/pinExpiryJob';
import './jobs/bidExpiryJob';
import './jobs/depositExpiryJob';
import './jobs/fx-rate-sync.queue';

async function bootstrap() {
  initObservability();

  const app = createApp();

  void env;

  await AppDataSource.initialize();

  startAnomalyDetectionJob();
  startApiMetricsMaintenanceJob();

  const port = process.env.PORT || env.PORT || 3000;
  app.listen(Number(port), '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Sabo Finance API listening on :${port}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server', err);
  process.exit(1);
});
