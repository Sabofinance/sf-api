import { withTransaction } from '../database/transaction';
import { AppError } from '../utils/errors';
import { recordSecurityEvent } from './securityEvent.service';
import { SecurityEventType } from '../utils/observabilityEnums';
import type { Request } from 'express';

export function getLoginMaxFailedAttempts(): number {
  const n = Number(process.env.LOGIN_MAX_FAILED_ATTEMPTS ?? 5);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export function getLoginLockoutMinutes(): number {
  const n = Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

export function isAccountLocked(lockedUntil: Date | string | null | undefined): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
}

export function throwIfLocked(lockedUntil: Date | string | null | undefined): void {
  if (!isAccountLocked(lockedUntil)) return;
  throw new AppError(
    'ACCOUNT_LOCKED',
    `This account is temporarily locked after too many failed sign-in attempts. Try again later.`,
    429,
  );
}

export async function recordFailedLogin(userId: string, req?: Request): Promise<boolean> {
  const max = getLoginMaxFailedAttempts();
  const minutes = getLoginLockoutMinutes();

  const rows = (await withTransaction(async (qr) => {
    return qr.query(
      `UPDATE "users"
       SET "failed_login_attempts" = "failed_login_attempts" + 1,
           "locked_until" = CASE
             WHEN "failed_login_attempts" + 1 >= $2
             THEN NOW() + ($3 || ' minutes')::interval
             ELSE "locked_until"
           END
       WHERE "id" = $1
       RETURNING "failed_login_attempts", "locked_until"`,
      [userId, max, String(minutes)],
    );
  })) as Array<{ failed_login_attempts: number; locked_until: Date | null }>;

  const locked = isAccountLocked(rows[0]?.locked_until);
  if (locked) {
    void recordSecurityEvent({
      eventType: SecurityEventType.account_locked,
      req,
      userId,
      details: { failed_login_attempts: rows[0]?.failed_login_attempts },
    });
  }
  return locked;
}

export async function clearFailedLogins(userId: string): Promise<void> {
  await withTransaction(async (qr) => {
    await qr.query(
      `UPDATE "users" SET "failed_login_attempts" = 0, "locked_until" = NULL WHERE "id" = $1`,
      [userId],
    );
  });
}
