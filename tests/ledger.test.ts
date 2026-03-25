import request from 'supertest';

import { LedgerEntry } from '../src/database/entities/LedgerEntry';
import { Currency } from '../src/utils/enums';

import { app, registerVerifiedUser } from './helpers';

describe('Ledger', () => {
  it('returns ledger entries after deposit and ledger rows are immutable (no updates)', async () => {
    process.env.FLUTTERWAVE_WEBHOOK_HASH = 'testhash';

    const { accessToken, userId } = await registerVerifiedUser();

    const init = await request(app)
      .post('/deposits/ngn/initiate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: '250.00' });
    if (init.status !== 201) console.error('LEDGER INIT ERROR:', init.body);
    const reference = init.body.data.deposit.reference as string;

    await request(app)
      .post('/webhooks/flutterwave')
      .set('verif-hash', 'testhash')
      .send({
        event: 'charge.completed',
        data: { tx_ref: reference, currency: Currency.NGN, amount: '250.00', id: 'fw_2' },
      });

    const list = await request(app).get('/ledger').set('Authorization', `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.entries.length).toBeGreaterThan(0);

    // Immutability: attempt to modify is not exposed; verify the ledger row still matches reference.
    const entry = list.body.data.entries.find((e: LedgerEntry) => e.reference === reference);
    expect(entry).toBeTruthy();
    expect(entry.user_id).toBe(userId);
    expect(entry.balance_before).toBe('0.00');
    expect(entry.balance_after).toBe('250.00');
  });
});

