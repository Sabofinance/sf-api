import request from 'supertest';

import { ExchangeRate } from '../src/database/entities/ExchangeRate'
import { withTransaction } from '../src/database/transaction';

import { app } from './helpers';;

describe('Exchange Rates', () => {
  it('returns latest rate per pair', async () => {
    await withTransaction(async (qr) => {
      await qr.query(
        `INSERT INTO "exchange_rates" ("id","pair","rate","source","created_at") VALUES (gen_random_uuid(), 'NGN/USD', '0.001000', 'test', now() - interval '10 seconds')`,
      );
      await qr.query(
        `INSERT INTO "exchange_rates" ("id","pair","rate","source","created_at") VALUES (gen_random_uuid(), 'NGN/USD', '0.001200', 'test', now())`,
      );
      await qr.query(
        `INSERT INTO "exchange_rates" ("id","pair","rate","source","created_at") VALUES (gen_random_uuid(), 'NGN/GBP', '0.000800', 'test', now())`,
      );
    });

    const res = await request(app).get('/rates');
    expect(res.status).toBe(200);
    const rates = res.body.data.rates as ExchangeRate[];
    const usd = rates.find((r) => r.pair === 'NGN/USD');
    expect(usd!.rate).toBe('0.001200');
  });
});

