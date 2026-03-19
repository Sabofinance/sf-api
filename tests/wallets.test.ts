import request from 'supertest';

import { Wallet } from '../src/database/entities/Wallet';

import { app, registerAndLogin } from './helpers';

describe('Wallets', () => {
  it('creates wallets automatically on registration (NGN, GBP, USD, CAD)', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app).get('/wallets').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const currencies = (res.body.data.wallets as Wallet[]).map((w) => w.currency).sort();
    expect(currencies).toEqual(['CAD', 'GBP', 'NGN', 'USD']);
  });

  it('returns wallet by currency', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app).get('/wallets/NGN').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const wallet = res.body.data.wallet as Wallet;
    expect(wallet.currency).toBe('NGN');
  });
});

