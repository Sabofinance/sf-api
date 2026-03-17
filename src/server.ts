import { createApp } from './app';
import { AppDataSource } from './database/data-source';
import { env } from './config/env';

async function bootstrap() {
  const app = createApp();

  // Validate required env for runtime startup.
  void env;

  await AppDataSource.initialize();

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Sabo Finance API listening on :${port}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server', err);
  process.exit(1);
});

