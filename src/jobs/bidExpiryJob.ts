import { Bid } from '../database/entities/Bid';
import { withTransaction } from '../database/transaction';
import { sendEmail } from '../services/emailService';
import { NotificationService } from '../services/notificationService';
import { WalletService } from '../services/walletService';
import { BidStatus, Currency, LedgerType, NotificationType } from '../utils/enums';
import { ReliabilityComponent } from '../utils/observabilityEnums';
import { runMonitoredJob } from '../utils/jobMonitor';

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

setInterval(() => {
  runMonitoredJob(ReliabilityComponent.background_jobs, 'bidExpiryJob', checkExpiredBids).catch(
    (err) => console.error('[bidExpiryJob] error:', err),
  );
}, 5 * 60 * 1000);
