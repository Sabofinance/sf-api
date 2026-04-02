import { Queue, Worker, Job } from 'bullmq';

import { env } from '../config/env';
import { Deposit } from '../database/entities/Deposit';
import { withTransaction } from '../database/transaction';
import { NotificationService } from '../services/notificationService';
import { DepositStatus, NotificationType } from '../utils/enums';

const redisHost = env.REDIS_URL || env.REDIS_HOST || 'localhost';

// Parse Redis URL if provided to configure BullMQ correctly
let connection: any = {
  host: redisHost,
  port: env.REDIS_PORT || 6379,
};

if (env.REDIS_URL) {
  try {
    const parsed = new URL(env.REDIS_URL);
    connection = {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      tls: parsed.protocol === 'rediss:' ? {
        rejectUnauthorized: false
      } : undefined,
    };
  } catch (e) {
    console.error('Failed to parse REDIS_URL', e);
  }
}

export const depositExpiryQueue = new Queue('deposit-expiry', { connection });

export const depositExpiryWorker = new Worker('deposit-expiry', async (job: Job) => {
  if (job.name === 'check-expired-deposits') {
    await checkExpiredDeposits();
  }
}, { connection });

async function checkExpiredDeposits() {
  await withTransaction(async (qr) => {
    // Mark deposits as expired if they've been in 'initiated' for over 24 hours.
    // This cleans up stale payment links.
    const expiredDeposits = (await qr.query(
      `SELECT * FROM "deposits" 
       WHERE "status" = $1 
       AND "created_at" < NOW() - INTERVAL '24 hours'
       FOR UPDATE SKIP LOCKED`,
      [DepositStatus.initiated],
    )) as Deposit[];

    for (const deposit of expiredDeposits) {
      await qr.query(`UPDATE "deposits" SET "status" = $1 WHERE "id" = $2`, [
        DepositStatus.expired,
        deposit.id,
      ]);

      const notificationService = new NotificationService();
      await notificationService.createNotification({
        queryRunner: qr,
        userId: deposit.user_id,
        title: 'Deposit Expired',
        message: `Your deposit of ${deposit.amount} ${deposit.currency} (${deposit.reference}) has expired.`,
        type: NotificationType.info,
        relatedId: deposit.id,
      });
    }
  });
}

// Every hour
depositExpiryQueue.add('check-expired-deposits', {}, {
  repeat: {
    pattern: '0 * * * *',
  },
});