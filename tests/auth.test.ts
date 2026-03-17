import request from 'supertest';
import bcrypt from 'bcrypt';

import { app, registerAndLogin } from './helpers';
import { withTransaction } from '../src/database/transaction';

describe('Auth', () => {
  it('registers a user, hashes password, and returns JWT tokens', async () => {
    const email = `user_${Date.now()}@example.com`;
    const phone = `+2348${Math.floor(Math.random() * 1e9)}`;
    const password = 'Password123!';

    const res = await request(app).post('/auth/register').send({ name: 'User', email, phone, password });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(res.body.data.tokens.refreshToken).toBeTruthy();

    const row = await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT "password_hash" FROM "users" WHERE "email" = $1`, [email.toLowerCase()])) as Array<{
        password_hash: string;
      }>;
      return rows[0];
    });
    expect(row.password_hash).toBeTruthy();
    expect(row.password_hash).not.toEqual(password);
    expect(await bcrypt.compare(password, row.password_hash)).toBe(true);
  });

  it('logs in and returns access token', async () => {
    const { email, password } = await registerAndLogin();
    const res = await request(app).post('/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
  });

  it('rejects invalid credentials', async () => {
    const { email } = await registerAndLogin();
    const res = await request(app).post('/auth/login').send({ email, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

