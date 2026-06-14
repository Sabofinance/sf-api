import { Deposit } from '../database/entities/Deposit';
import { withTransaction } from '../database/transaction';
import { NotificationService } from '../services/notificationService';
import { DepositStatus, NotificationType } from '../utils/enums';
import { ReliabilityComponent } from '../utils/observabilityEnums';
import { runMonitoredJob } from '../utils/jobMonitor';

async function checkExpiredDeposits() {
  await withTransaction(async (qr) => {
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

setInterval(() => {
  runMonitoredJob(ReliabilityComponent.background_jobs, 'depositExpiryJob', checkExpiredDeposits).catch(
    (err) => console.error('[depositExpiryJob] error:', err),
  );
}, 60 * 60 * 1000);
