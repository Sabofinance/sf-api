import crypto from 'crypto';

import jwt from 'jsonwebtoken';

import { withTransaction } from '../database/transaction';
import { AppError } from '../utils/errors';

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function expiryFromToken(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (decoded?.exp) return new Date(decoded.exp * 1000);
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

export async function persistRefreshToken(userId: string, token: string): Promise<void> {
  await withTransaction(async (qr) => {
    await qr.query(
      `INSERT INTO "refresh_tokens" ("id","user_id","token_hash","expires_at","revoked_at","created_at")
       VALUES (gen_random_uuid(), $1, $2, $3, NULL, NOW())`,
      [userId, hashRefreshToken(token), expiryFromToken(token)],
    );
  });
}

export async function assertRefreshTokenActive(token: string): Promise<string> {
  const rows = (await withTransaction(async (qr) => {
    return qr.query(
      `SELECT "user_id","revoked_at","expires_at" FROM "refresh_tokens" WHERE "token_hash" = $1 LIMIT 1`,
      [hashRefreshToken(token)],
    );
  })) as Array<{ user_id: string; revoked_at: Date | null; expires_at: Date }>;

  const row = rows[0];
  if (!row) {
    throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired. Sign in again to obtain new tokens.', 401);
  }
  if (row.revoked_at) {
    throw new AppError('REFRESH_TOKEN_REVOKED', 'Refresh token has been revoked. Sign in again.', 401);
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired. Sign in again to obtain new tokens.', 401);
  }
  return row.user_id;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await withTransaction(async (qr) => {
    await qr.query(
      `UPDATE "refresh_tokens" SET "revoked_at" = NOW() WHERE "token_hash" = $1 AND "revoked_at" IS NULL`,
      [hashRefreshToken(token)],
    );
  });
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await withTransaction(async (qr) => {
    await qr.query(
      `UPDATE "refresh_tokens" SET "revoked_at" = NOW() WHERE "user_id" = $1 AND "revoked_at" IS NULL`,
      [userId],
    );
  });
}
