import request from 'supertest';

import { createApp } from '../src/app';
import { withTransaction } from '../src/database/transaction';
import { UserRole } from '../src/utils/enums';

export const app = createApp();

export async function registerAndLogin() {
  const email = `user_${Date.now()}@example.com`;
  const phone = `+2348${Math.floor(Math.random() * 1e9)}`;
  const password = 'Password123!';

  const reg = await request(app).post('/auth/register').send({
    name: 'Test User',
    email,
    phone,
    password,
  });
  const accessToken = reg.body?.data?.tokens?.accessToken as string;
  return { email, phone, password, accessToken, userId: reg.body?.data?.user?.id as string };
}

export async function makeAdmin(userId: string) {
  await withTransaction(async (qr) => {
    await qr.query(`UPDATE "users" SET "role" = $1 WHERE "id" = $2`, [UserRole.admin, userId]);
  });
}

