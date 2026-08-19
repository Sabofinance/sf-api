import request from 'supertest';

import { Currency } from '../src/utils/enums';
import { withTransaction } from '../src/database/transaction';

import { app, registerAndLogin, registerVerifiedUser } from './helpers';

describe('Security hardening', () => {
  it('rejects missing and invalid bearer tokens', async () => {
    const missing = await request(app).get('/wallets');
    expect(missing.status).toBe(401);
    expect(missing.body.success).toBe(false);

    const invalid = await request(app).get('/wallets').set('Authorization', 'Bearer not-a-jwt');
    expect(invalid.status).toBe(401);
    expect(invalid.body.success).toBe(false);
  });

  it('rejects non-admin access to admin routes', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app).get('/admin/users').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('blocks unverified KYC from initiating deposits', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/deposits/ngn/initiate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: '1000.00' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_NOT_VERIFIED');
  });

  it('does not credit wallet when Flutterwave signature is missing or invalid', async () => {
    process.env.FLUTTERWAVE_WEBHOOK_HASH = 'testhash';
    const { accessToken, userId } = await registerVerifiedUser();
    const init = await request(app)
      .post('/deposits/ngn/initiate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: '1000.00' });
    const reference = init.body.data.deposit.reference as string;
    const payload = {
      event: 'charge.completed',
      data: { tx_ref: reference, currency: Currency.NGN, amount: '1000.00', id: 'fw_bad' },
    };

    const missing = await request(app).post('/webhooks/flutterwave').send(payload);
    expect(missing.status).toBe(200);

    const wrong = await request(app).post('/webhooks/flutterwave').set('verif-hash', 'wrong').send(payload);
    expect(wrong.status).toBe(200);

    const wallet = await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT "balance" FROM "wallets" WHERE "user_id" = $1 AND "currency" = $2`, [
        userId,
        Currency.NGN,
      ])) as Array<{ balance: string }>;
      return rows[0].balance;
    });
    expect(wallet).toBe('0.00');
  });

  it('does not credit on amount mismatch and does not double-credit on replay', async () => {
    process.env.FLUTTERWAVE_WEBHOOK_HASH = 'testhash';
    const { accessToken, userId } = await registerVerifiedUser();
    const init = await request(app)
      .post('/deposits/ngn/initiate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: '1000.00' });
    const reference = init.body.data.deposit.reference as string;

    const mismatch = await request(app)
      .post('/webhooks/flutterwave')
      .set('verif-hash', 'testhash')
      .send({
        event: 'charge.completed',
        data: { tx_ref: reference, currency: Currency.NGN, amount: '1.00', id: 'fw_mismatch' },
      });
    expect(mismatch.status).toBe(200);

    const afterMismatch = await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT "balance" FROM "wallets" WHERE "user_id" = $1 AND "currency" = $2`, [
        userId,
        Currency.NGN,
      ])) as Array<{ balance: string }>;
      return rows[0].balance;
    });
    expect(afterMismatch).toBe('0.00');

    const goodPayload = {
      event: 'charge.completed',
      data: { tx_ref: reference, currency: Currency.NGN, amount: '1000.00', id: 'fw_ok' },
    };
    await request(app).post('/webhooks/flutterwave').set('verif-hash', 'testhash').send(goodPayload);
    await request(app).post('/webhooks/flutterwave').set('verif-hash', 'testhash').send(goodPayload);

    const afterReplay = await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT "balance" FROM "wallets" WHERE "user_id" = $1 AND "currency" = $2`, [
        userId,
        Currency.NGN,
      ])) as Array<{ balance: string }>;
      return rows[0].balance;
    });
    expect(afterReplay).toBe('1000.00');
  });

  it('revokes refresh tokens on logout', async () => {
    const reg = await request(app).post('/auth/register').send({
      name: 'Logout User',
      email: `logout_${Date.now()}@example.com`,
      phone: `+2348${Math.floor(Math.random() * 1e9)}`,
      password: 'Password123!',
    });
    const refresh = reg.body.data.tokens.refreshToken as string;
    const access = reg.body.data.tokens.accessToken as string;

    const logout = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .send({ refreshToken: refresh });
    expect(logout.status).toBe(200);

    const refreshed = await request(app).post('/auth/refresh-token').send({ refreshToken: refresh });
    expect(refreshed.status).toBe(401);
    expect(refreshed.body.success).toBe(false);
  });

  it('locks the account after repeated failed logins', async () => {
    process.env.LOGIN_MAX_FAILED_ATTEMPTS = '3';
    const { email } = await registerAndLogin();

    await request(app).post('/auth/login').send({ email, password: 'WrongPass1' });
    await request(app).post('/auth/login').send({ email, password: 'WrongPass1' });
    await request(app).post('/auth/login').send({ email, password: 'WrongPass1' });

    const locked = await request(app).post('/auth/login').send({ email, password: 'WrongPass1' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    delete process.env.LOGIN_MAX_FAILED_ATTEMPTS;
  });

  it('rejects weak passwords on register', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Weak Pass',
      email: `weak_${Date.now()}@example.com`,
      phone: `+2348${Math.floor(Math.random() * 1e9)}`,
      password: 'password',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
