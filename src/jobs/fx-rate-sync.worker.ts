import { Worker, type ConnectionOptions } from 'bullmq';

import { env } from '../config/env';
import { withTransaction } from '../database/transaction';

function connectionFromUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    maxRetriesPerRequest: null,
  } as ConnectionOptions;
}

type FxRow = { pair: string; rate: string; source: string };

async function fetchRates(): Promise<FxRow[]> {
  // Phase 1: Job skeleton. In tests we can insert directly into exchange_rates.
  // When FX provider is configured, this function should fetch NGN/USD, NGN/GBP, NGN/CAD.
  return [];
}

export const fxRateSyncWorker = new Worker(
  'fx-rate-sync',
  async () => {
    const rows = await fetchRates();
    if (rows.length === 0) return { inserted: 0 };

    await withTransaction(async (qr) => {
      for (const row of rows) {
        await qr.query(
          `INSERT INTO "exchange_rates" ("id","pair","rate","source","created_at") VALUES (gen_random_uuid(), $1,$2,$3, now())`,
          [row.pair, row.rate, row.source],
        );
      }
    });

    return { inserted: rows.length };
  },
  { connection: connectionFromUrl(env.REDIS_URL ?? 'redis://localhost:6379') },
);

