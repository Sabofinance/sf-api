import { Queue, type ConnectionOptions } from 'bullmq';

import { env } from '../config/env';

function connectionFromUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    // BullMQ uses ioredis internally; passing raw connection options avoids type conflicts.
    maxRetriesPerRequest: null,
  } as ConnectionOptions;
}

export const fxRateSyncQueue = new Queue('fx-rate-sync', {
  connection: connectionFromUrl(env.REDIS_URL ?? 'redis://localhost:6379'),
});

