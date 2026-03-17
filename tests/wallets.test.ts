import request from 'supertest';

import { app, registerAndLogin } from './helpers';

describe('Wallets', () => {
  it('creates wallets automatically on registration (NGN, GBP, USD, CAD)', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app).get('/wallets').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const currencies = (res.body.data.wallets as any[]).map((w) => w.currency).sort();
    expect(currencies).toEqual(['CAD', 'GBP', 'NGN', 'USD']);
  });

  it('returns wallet by currency', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app).get('/wallets/NGN').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.currency).toBe('NGN');
  });
});

