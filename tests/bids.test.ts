import request from 'supertest';
import { Currency, SabitStatus, SabitType } from '../src/utils/enums';
import { app, registerVerifiedUser } from './helpers';
import { withTransaction } from '../src/database/transaction';

describe('Bids Endpoints', () => {
  it('buyer can place a bid, and seller can accept it', async () => {
    const seller = await registerVerifiedUser();
    const buyer = await registerVerifiedUser();

    // Set PINs
    await request(app).post('/account/transaction-pin/set').set('Authorization', `Bearer ${seller.accessToken}`).send({ pin: '123456', confirm_pin: '123456' });
    await request(app).post('/account/transaction-pin/set').set('Authorization', `Bearer ${buyer.accessToken}`).send({ pin: '654321', confirm_pin: '654321' });

    // Fund wallets
    await withTransaction(async (qr) => {
      await qr.query(`UPDATE "wallets" SET "balance" = '1000.00' WHERE "user_id" = $1 AND "currency" = $2`, [seller.userId, Currency.USD]);
      await qr.query(`UPDATE "wallets" SET "balance" = '2000000.00' WHERE "user_id" = $1 AND "currency" = $2`, [buyer.userId, Currency.NGN]);
    });

    // Create a listing
    const sabitCreate = await request(app).post('/sabits').set('Authorization', `Bearer ${seller.accessToken}`).send({
      type: SabitType.SELL,
      currency: Currency.USD,
      amount: '100.00',
      rate_ngn: '1500.00',
      min_amount: '10.00',
      max_amount: '100.00',
      pin: '123456',
    });
    expect(sabitCreate.status).toBe(201);
    const sabitId = sabitCreate.body.data.sabit.id;

    // Place a bid
    const bidPlace = await request(app).post('/bids').set('Authorization', `Bearer ${buyer.accessToken}`).send({
      sabit_id: sabitId,
      amount: '50.00',
      proposed_rate_ngn: '1400.00',
      pin: '654321',
    });
    expect(bidPlace.status).toBe(201);
    const bidId = bidPlace.body.data.bid.id;

    // Get Mine
    const getMine = await request(app).get('/bids/mine').set('Authorization', `Bearer ${buyer.accessToken}`);
    expect(getMine.status).toBe(200);
    expect(getMine.body.data.bids.length).toBeGreaterThan(0);

    // Get Received
    const getReceived = await request(app).get('/bids/received').set('Authorization', `Bearer ${seller.accessToken}`);
    expect(getReceived.status).toBe(200);
    expect(getReceived.body.data.bids.length).toBeGreaterThan(0);

    // Accept bid
    const accept = await request(app).put(`/bids/${bidId}/accept`).set('Authorization', `Bearer ${seller.accessToken}`).send({ pin: '123456' });
    expect(accept.status).toBe(200);
    expect(accept.body.data.trade).toBeDefined();
  });

  it('seller can reject a bid and funds are returned', async () => {
    const seller = await registerVerifiedUser();
    const buyer = await registerVerifiedUser();

    await request(app).post('/account/transaction-pin/set').set('Authorization', `Bearer ${seller.accessToken}`).send({ pin: '123456', confirm_pin: '123456' });
    await request(app).post('/account/transaction-pin/set').set('Authorization', `Bearer ${buyer.accessToken}`).send({ pin: '654321', confirm_pin: '654321' });

    await withTransaction(async (qr) => {
      await qr.query(`UPDATE "wallets" SET "balance" = '100.00' WHERE "user_id" = $1 AND "currency" = $2`, [seller.userId, Currency.USD]);
      await qr.query(`UPDATE "wallets" SET "balance" = '200000.00' WHERE "user_id" = $1 AND "currency" = $2`, [buyer.userId, Currency.NGN]);
    });

    const sabitCreate = await request(app).post('/sabits').set('Authorization', `Bearer ${seller.accessToken}`).send({
      type: SabitType.SELL,
      currency: Currency.USD,
      amount: '50.00',
      rate_ngn: '1500.00',
      min_amount: '10.00',
      max_amount: '50.00',
      pin: '123456',
    });
    const sabitId = sabitCreate.body.data.sabit.id;

    const bidPlace = await request(app).post('/bids').set('Authorization', `Bearer ${buyer.accessToken}`).send({
      sabit_id: sabitId,
      amount: '20.00',
      proposed_rate_ngn: '1450.00',
      pin: '654321',
    });
    const bidId = bidPlace.body.data.bid.id;

    const reject = await request(app).put(`/bids/${bidId}/reject`).set('Authorization', `Bearer ${seller.accessToken}`).send({ pin: '123456', reason: 'Too low' });
    expect(reject.status).toBe(200);

    // Verify buyer's NGN is restored
    const balance = await withTransaction(async (qr) => {
      const rows = await qr.query(`SELECT "balance", "locked_balance" FROM "wallets" WHERE "user_id" = $1 AND "currency" = $2`, [buyer.userId, Currency.NGN]) as any[];
      return rows[0];
    });
    expect(balance.balance).toBe('200000.00');
    expect(balance.locked_balance).toBe('0.00');
  });
});