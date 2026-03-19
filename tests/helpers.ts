import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../src/app';
import { withTransaction } from '../src/database/transaction';
import { KycStatus, UserRole } from '../src/utils/enums';

export const app = createApp();

type TokenInput = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  kyc_status: KycStatus | string;
};

export function signTestAccessToken(input: TokenInput) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required for tests');
  return jwt.sign(input, process.env.JWT_SECRET, { expiresIn: '15m' });
}

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

  return {
    email,
    phone,
    password,
    accessToken: reg.body?.data?.tokens?.accessToken as string,
    userId: reg.body?.data?.user?.id as string,
    name: reg.body?.data?.user?.name as string,
  };
}

export async function registerVerifiedUser() {
  const user = await registerAndLogin();
  await withTransaction(async (qr) => {
    await qr.query(`UPDATE "users" SET "kyc_status" = $1 WHERE "id" = $2`, [KycStatus.verified, user.userId]);
  });

  const verifiedToken = signTestAccessToken({
    id: user.userId,
    name: user.name,
    email: user.email,
    role: UserRole.user,
    kyc_status: KycStatus.verified,
  });

  return { ...user, accessToken: verifiedToken };
}

export async function makeAdmin(userId: string) {
  await withTransaction(async (qr) => {
    await qr.query(`UPDATE "users" SET "role" = $1 WHERE "id" = $2`, [UserRole.admin, userId]);
  });
}

export function signAdminToken(userId: string, name: string, email: string) {
  return signTestAccessToken({
    id: userId,
    name,
    email,
    role: UserRole.admin,
    kyc_status: KycStatus.verified,
  });
}

