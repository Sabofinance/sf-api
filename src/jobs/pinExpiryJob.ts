import { Queue, Worker, Job } from 'bullmq';
import Decimal from 'decimal.js';

import { env } from '../config/env';
import { Sabit } from '../database/entities/Sabit';
import { Trade } from '../database/entities/Trade';
import { withTransaction } from '../database/transaction';
import { sendEmail } from '../services/emailService';
import { NotificationService } from '../services/notificationService';
import { TradeStatus, NotificationType } from '../utils/enums';

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
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
    };
  } catch (e) {
    console.error('Failed to parse REDIS_URL', e);
  }
}

export const pinExpiryQueue = new Queue('pin-expiry', { connection });

export const pinExpiryWorker = new Worker('pin-expiry', async (job: Job) => {
  if (job.name === 'check-expired-trades') {
    await checkExpiredTrades();
  }
}, { connection });

async function checkExpiredTrades() {
  await withTransaction(async (qr) => {
    // Find all unconfirmed trades past their expiry
    const expiredTrades = (await qr.query(
      `SELECT * FROM "trades" 
       WHERE "status" IN ($1, $2) 
       AND "pin_expires_at" < NOW() 
       AND "seller_pin_verified" = false 
       FOR UPDATE SKIP LOCKED`,
      [TradeStatus.escrowed, TradeStatus.initiated],
    )) as Trade[];

    for (const trade of expiredTrades) {
      // 1. Mark trade as cancelled
      await qr.query(`UPDATE "trades" SET "status" = $1 WHERE "id" = $2`, [
        TradeStatus.cancelled,
        trade.id,
      ]);

      // 2. Release funds (Restore Sabit available amount)
      const sabitRows = (await qr.query(`SELECT * FROM "sabits" WHERE "id" = $1 FOR UPDATE`, [
        trade.sabit_id,
      ])) as Sabit[];

      if (sabitRows.length > 0) {
        const sabit = sabitRows[0];
        const restoredAmount = new Decimal(sabit.available_amount).plus(new Decimal(trade.amount));
        await qr.query(`UPDATE "sabits" SET "available_amount" = $1 WHERE "id" = $2`, [
          restoredAmount.toFixed(2),
          sabit.id,
        ]);
      }

      const notificationService = new NotificationService();

      // 3. Notify Buyer
      await notificationService.createNotification({
        queryRunner: qr,
        userId: trade.buyer_id,
        title: 'Trade Cancelled',
        message: `The 10-minute confirmation window expired for trade ${trade.reference}.`,
        type: NotificationType.warning,
        relatedId: trade.id,
      });

      const buyerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [trade.buyer_id]);
      if (buyerRows.length > 0) {
        await sendEmail({
          to: buyerRows[0].email,
          subject: 'Trade Cancelled — PIN Expired',
          template: 'pin-expired-cancellation',
          context: { reference: trade.reference }
        });
      }

      // 4. Notify Seller
      await notificationService.createNotification({
        queryRunner: qr,
        userId: trade.seller_id,
        title: 'Trade Cancelled',
        message: `You did not confirm trade ${trade.reference} within 10 minutes. It has been cancelled.`,
        type: NotificationType.warning,
        relatedId: trade.id,
      });

      const sellerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [trade.seller_id]);
      if (sellerRows.length > 0) {
        await sendEmail({
          to: sellerRows[0].email,
          subject: 'Trade Cancelled — PIN Expired',
          template: 'pin-expired-cancellation',
          context: { reference: trade.reference }
        });
      }
    }
  });
}

// Add the repeatable job to run every minute
pinExpiryQueue.add('check-expired-trades', {}, {
  repeat: {
    pattern: '* * * * *', // Runs every minute
  }
});