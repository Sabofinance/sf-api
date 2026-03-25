import request from 'supertest';

// import { Deposit } from '../src/database/entities/Deposit';
import { LedgerEntry } from '../src/database/entities/LedgerEntry';
import { withTransaction } from '../src/database/transaction';
import { Currency, DepositStatus } from '../src/utils/enums';

import { app, makeAdmin, MIN_VALID_PNG, registerVerifiedUser } from './helpers';

describe('Deposits', () => {
  it('initiates NGN deposit', async () => {
    const { accessToken } = await registerVerifiedUser();
    const res = await request(app)
      .post('/deposits/ngn/initiate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: '5000.00' });
    expect(res.status).toBe(201);
    expect(res.body.data.deposit.currency).toBe('NGN');
    expect(res.body.data.deposit.reference).toMatch(/^DEP-\d{4}-\d{6}$/);
  });

  it('processes Flutterwave webhook: credits wallet, creates ledger, prevents duplicates', async () => {
    process.env.FLUTTERWAVE_WEBHOOK_HASH = 'testhash';

    const { accessToken, userId } = await registerVerifiedUser();
    const init = await request(app)
      .post('/deposits/ngn/initiate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: '1000.00' });
    const reference = init.body.data.deposit.reference as string;

    const webhookPayload = {
      event: 'charge.completed',
      data: {
        tx_ref: reference,
        currency: Currency.NGN,
        amount: '1000.00',
        id: 'fw_1',
      },
    };

    const w1 = await request(app)
      .post('/webhooks/flutterwave')
      .set('verif-hash', 'testhash')
      .send(webhookPayload);
    expect(w1.status).toBe(200);

    const walletAfter = await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT "balance" FROM "wallets" WHERE "user_id" = $1 AND "currency" = $2`, [
        userId,
        Currency.NGN,
      ])) as Array<{ balance: string }>;
      return rows[0].balance;
    });
    expect(walletAfter).toBe('1000.00');

    const ledgerRows = await withTransaction(async (qr) => {
      return (await qr.query(`SELECT * FROM "ledger" WHERE "reference" = $1`, [reference])) as LedgerEntry[];
    });
    expect(ledgerRows.length).toBe(1);
    expect(ledgerRows[0].balance_before).toBe('0.00');
    expect(ledgerRows[0].balance_after).toBe('1000.00');

    // Duplicate webhook should not double-credit.
    await request(app).post('/webhooks/flutterwave').set('verif-hash', 'testhash').send(webhookPayload);
    const walletAfter2 = await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT "balance" FROM "wallets" WHERE "user_id" = $1 AND "currency" = $2`, [
        userId,
        Currency.NGN,
      ])) as Array<{ balance: string }>;
      return rows[0].balance;
    });
    expect(walletAfter2).toBe('1000.00');
  });

  it('submits foreign deposit and credits only on admin approval', async () => {
    // Skip if Cloudinary not configured for this environment.
    if (!process.env.CLOUDINARY_URL) return;

    const user = await registerVerifiedUser();

    const submit = await request(app)
      .post('/deposits/foreign')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .field('currency', Currency.USD)
      .field('amount', '50.00')
      .attach('proof', MIN_VALID_PNG, { filename: 'proof.png', contentType: 'image/png' });
    expect(submit.status).toBe(201);
    expect(submit.body.data.deposit.status).toBe(DepositStatus.pending_review);

    const admin = await registerVerifiedUser();
    await makeAdmin(admin.userId);

    const before = await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT "balance" FROM "wallets" WHERE "user_id" = $1 AND "currency" = $2`, [
        user.userId,
        Currency.USD,
      ])) as Array<{ balance: string }>;
      return rows[0].balance;
    });

    const approve = await request(app)
      .post(`/admin/deposits/${submit.body.data.deposit.id}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send();
    expect(approve.status).toBe(200);
    expect(approve.body.data.deposit.status).toBe(DepositStatus.completed);

    const after = await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT "balance" FROM "wallets" WHERE "user_id" = $1 AND "currency" = $2`, [
        user.userId,
        Currency.USD,
      ])) as Array<{ balance: string }>;
      return rows[0].balance;
    });

    expect(before).toBe('0.00');
    expect(after).toBe('50.00');
  });
});

