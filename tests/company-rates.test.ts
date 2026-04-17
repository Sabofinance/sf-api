import request from 'supertest';

import { app, makeAdmin, registerAndLogin, signAdminToken } from './helpers';

describe('Company Rates module', () => {
  it('allows admin to create/update rates and public to retrieve them', async () => {
    const user = await registerAndLogin();
    await makeAdmin(user.userId);
    const adminToken = signAdminToken(user.userId, user.name, user.email);

    const createResponse = await request(app)
      .post('/admin/company-rates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currency: 'USD', rate_ngn: '1500.00' });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.success).toBe(true);
    expect(createResponse.body.data.rate).toMatchObject({ currency: 'USD', rate_ngn: '1500.00' });

    const getAdminResponse = await request(app)
      .get('/admin/company-rates/USD')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getAdminResponse.status).toBe(200);
    expect(getAdminResponse.body.data.rate.currency).toBe('USD');
    expect(getAdminResponse.body.data.rate.rate_ngn).toBe('1500.00');

    const publicListResponse = await request(app).get('/company-rates');
    expect(publicListResponse.status).toBe(200);
    expect(Array.isArray(publicListResponse.body.data.rates)).toBe(true);
    expect(publicListResponse.body.data.rates).toEqual(
      expect.arrayContaining([expect.objectContaining({ currency: 'USD', rate_ngn: '1500.00' })]),
    );

    const updateResponse = await request(app)
      .post('/admin/company-rates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currency: 'usd', rate_ngn: '1600.00' });

    expect(updateResponse.status).toBe(201);
    expect(updateResponse.body.data.rate.rate_ngn).toBe('1600.00');

    const publicSingleResponse = await request(app).get('/company-rates/USD');
    expect(publicSingleResponse.status).toBe(200);
    expect(publicSingleResponse.body.data.rate.rate_ngn).toBe('1600.00');

    const unauthorizedResponse = await request(app)
      .post('/admin/company-rates')
      .send({ currency: 'EUR', rate_ngn: '1700.00' });
    expect(unauthorizedResponse.status).toBe(401);
  });
});
