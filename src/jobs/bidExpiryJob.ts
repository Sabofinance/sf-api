import { Queue, Worker, Job } from 'bullmq';
import { env } from '../config/env';
import { Bid } from '../database/entities/Bid';
import { withTransaction } from '../database/transaction';
import { sendEmail } from '../services/emailService';
import { NotificationService } from '../services/notificationService';
import { WalletService } from '../services/walletService';
import { BidStatus, Currency, LedgerType, NotificationType } from '../utils/enums';

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

export const bidExpiryQueue = new Queue('bid-expiry', { connection });

export const bidExpiryWorker = new Worker('bid-expiry', async (job: Job) => {
  if (job.name === 'check-expired-bids') {
    await checkExpiredBids();
  }
}, { connection });

async function checkExpiredBids() {
  await withTransaction(async (qr) => {
    const expiredBids = (await qr.query(
      `SELECT * FROM "bids" 
       WHERE "status" = $1 
       AND "expires_at" < NOW() 
       FOR UPDATE SKIP LOCKED`,
      [BidStatus.pending],
    )) as Bid[];

    for (const bid of expiredBids) {
      await qr.query(`UPDATE "bids" SET "status" = $1 WHERE "id" = $2`, [
        BidStatus.expired,
        bid.id,
      ]);

      const walletService = new WalletService();
      await walletService.unlock({
        queryRunner: qr,
        userId: bid.buyer_id,
        currency: Currency.NGN,
        amount: bid.total_ngn_at_bid_rate,
        type: LedgerType.escrow_release,
        initiatedBy: bid.buyer_id,
        reference: `BID-EXP-${bid.reference}`,
      });

      const notificationService = new NotificationService();
      await notificationService.createNotification({
        queryRunner: qr,
        userId: bid.buyer_id,
        title: 'Bid Expired',
        message: `Your bid of ₦${bid.proposed_rate_ngn} per ${bid.currency} has expired. Your funds have been returned.`,
        type: NotificationType.info,
        relatedId: bid.id,
      });

      const buyerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [bid.buyer_id]);
      if (buyerRows.length > 0) {
        await sendEmail({
          to: buyerRows[0].email,
          subject: `Your Bid Has Expired — ${bid.reference}`,
          template: 'bid-expired-buyer',
          context: {
            reference: bid.reference,
            proposed_rate_ngn: bid.proposed_rate_ngn,
            amount: bid.amount,
            currency: bid.currency,
            total_ngn_at_bid_rate: bid.total_ngn_at_bid_rate,
          },
        });
      }
    }
  });
}

// Add the repeatable job
bidExpiryQueue.add('check-expired-bids', {}, {
  repeat: {
    pattern: '*/5 * * * *', // Every 5 minutes
  },
});
