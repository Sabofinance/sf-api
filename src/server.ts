import { createApp } from './app';
import { env } from './config/env';
import { AppDataSource } from './database/data-source';
import './jobs/pinExpiryJob'; // Initialize background jobs
import './jobs/bidExpiryJob';
import './jobs/depositExpiryJob';

async function bootstrap() {
  const app = createApp();

  // Validate required env for runtime startup.
  void env;

  await AppDataSource.initialize();

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

