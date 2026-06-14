import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../src/app';
import { AppDataSource } from '../src/database/data-source';
import { User } from '../src/database/entities/User';
import { withTransaction } from '../src/database/transaction';
import { KycStatus, UserRole } from '../src/utils/enums';

// Check if standard test env var exists to prevent wiping real local DBs if .env has dev
if (!process.env.DATABASE_URL_TEST) {
  throw new Error('DATABASE_URL_TEST must be defined in tests');
}

export const app = createApp();

/** 1×1 PNG — use in multipart tests when Cloudinary is enabled (avoids “Invalid image file”). */
export const MIN_VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  // Setup database connection for tests
  // We need to override the DATABASE_URL to use DATABASE_URL_TEST if we're in test mode
  if (process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  }
  
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
});

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

export async function makeSuperAdmin(userId: string) {
  await withTransaction(async (qr) => {
    await qr.query(`UPDATE "users" SET "role" = $1 WHERE "id" = $2`, [UserRole.super_admin, userId]);
  });
}

export function signAdminToken(userId: string, name: string, email: string, role: UserRole = UserRole.admin) {
  return signTestAccessToken({
    id: userId,
    name,
    email,
    role,
    kyc_status: KycStatus.verified,
  });
}

