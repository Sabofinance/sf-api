import { AppDataSource } from '../src/database/data-source';

jest.setTimeout(30000);

async function truncateAll() {
  const entities = AppDataSource.entityMetadatas;
  // Delete in a safe order by disabling FK checks via CASCADE truncation.
  const tableNames = entities.map((e) => `"${e.tableName}"`).join(', ');
  if (!tableNames) return;
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
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

