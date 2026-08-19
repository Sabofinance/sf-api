import { AppDataSource } from '../src/database/data-source';
import { stopRequestMetricsFlush } from '../src/middleware/requestMetricsMiddleware';

jest.setTimeout(120000);

async function truncateAll() {
  const tables = (await AppDataSource.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  )) as Array<{ tablename: string }>;
  if (!tables.length) return;
  const tableNames = tables.map((t) => `"${t.tablename}"`).join(', ');
  await AppDataSource.query(`TRUNCATE ${tableNames} RESTART IDENTITY CASCADE`);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST is required for integration tests');
  }

  await AppDataSource.initialize();
});

afterEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  stopRequestMetricsFlush();
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

