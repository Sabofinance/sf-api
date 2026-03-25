import bcrypt from 'bcrypt';
import { QueryRunner } from 'typeorm';

import { AppError } from '../utils/errors';

export async function verifyPin(userId: string, pin: string, qr: QueryRunner): Promise<boolean> {
  const rows = await qr.query(
    `SELECT "transaction_pin_hash", "transaction_pin_set" FROM "users" WHERE "id" = $1 LIMIT 1`,
    [userId]
  );
  
  const user = rows[0];
  if (!user || !user.transaction_pin_set || !user.transaction_pin_hash) {
    return false;
  }

  return bcrypt.compare(pin, user.transaction_pin_hash);
}

export async function requirePinSet(userId: string, qr: QueryRunner, customMessage?: string): Promise<void> {
  const rows = await qr.query(
    `SELECT "transaction_pin_set" FROM "users" WHERE "id" = $1 LIMIT 1`,
    [userId]
  );
  
  const user = rows[0];
  if (!user || !user.transaction_pin_set) {
    throw new AppError(
      'PIN_NOT_SET',
      customMessage || 'Set a 6-digit transaction PIN in Security settings before you can use this feature.',
      400,
    );
  }
}