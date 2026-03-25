import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { verifyPin } from '../../services/pinService';
import { ok } from '../../utils/apiResponse';
import { AppError } from '../../utils/errors';

const updateUsernameSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must not exceed 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
    .toLowerCase(),
});

/**
 * @swagger
 * /account/username:
 *   put:
 *     summary: Change user's unique username
 *     tags: [Account]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username: { type: string, example: "new_username_123" }
 *     responses:
 *       200:
 *         description: Username changed successfully
 *       409:
 *         description: Username already taken
 *       400:
 *         description: Invalid username format
 */
export async function updateUsername(req: Request, res: Response) {
  const { username } = updateUsernameSchema.parse(req.body);
  const userId = req.user!.id;

  const user = await withTransaction(async (qr) => {
    // 1. Check if the username is already taken by someone else
    const existing = await qr.query(
      `SELECT id FROM "users" WHERE "username" = $1 AND "id" != $2 LIMIT 1`,
      [username, userId]
    );

    if (existing.length > 0) {
      throw new AppError('USERNAME_TAKEN', 'This username is already taken', 409);
    }

    // 2. Fetch old username for logging
    const oldUserRows = await qr.query(
      `SELECT "username" FROM "users" WHERE "id" = $1 LIMIT 1`,
      [userId]
    );
    const oldUsername = oldUserRows[0]?.username;

    // 3. Update the username
    const updatedUserRows = await qr.query(
      `UPDATE "users" 
       SET "username" = $1 
       WHERE "id" = $2 
       RETURNING "id", "name", "username", "email", "phone", "email_verified", "phone_verified", "kyc_status", "role", "is_suspended", "created_at"`,
      [username, userId]
    );

    const updatedUser = Array.isArray(updatedUserRows[0]) ? updatedUserRows[0][0] : updatedUserRows[0];

    // 4. Log the action in admin_logs
    await qr.query(
      `INSERT INTO "admin_logs" ("id", "admin_id", "action", "target_type", "target_id", "details", "created_at")
       VALUES (gen_random_uuid(), $1, 'USERNAME_CHANGED', 'user', $2, $3, now())`,
      [
        userId, // Using the user's own ID as the actor for self-service logs
        userId,
        JSON.stringify({ old_username: oldUsername, new_username: username }),
      ]
    );

    return updatedUser;
  });

  return ok(res, { user });
}

const setPinSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
  confirm_pin: z.string().length(6),
}).refine(data => data.pin === data.confirm_pin, {
  message: 'PINs do not match',
  path: ['confirm_pin'],
});

/**
 * @swagger
 * /account/transaction-pin/set:
 *   post:
 *     summary: Set or update the transaction PIN
 *     tags: [Account]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pin, confirm_pin]
 *             properties:
 *               pin: { type: string, example: "123456" }
 *               confirm_pin: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: PIN set successfully
 */
export async function setTransactionPin(req: Request, res: Response) {
  const { pin } = setPinSchema.parse(req.body);
  const userId = req.user!.id;

  const pinHash = await bcrypt.hash(pin, 10);

  await withTransaction(async (qr) => {
    await qr.query(
      `UPDATE "users" SET "transaction_pin_hash" = $1, "transaction_pin_set" = true WHERE "id" = $2`,
      [pinHash, userId]
    );
  });

  await sendEmail({
    to: req.user!.email,
    subject: 'Transaction PIN Updated',
    template: 'pin-set',
    context: { name: req.user!.name },
  });

  return ok(res, { message: 'Transaction PIN set successfully' });
}

const verifyPinSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
});

/**
 * @swagger
 * /account/transaction-pin/verify:
 *   post:
 *     summary: Verify transaction PIN
 *     tags: [Account]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pin]
 *             properties:
 *               pin: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: PIN verification result
 */
export async function verifyTransactionPin(req: Request, res: Response) {
  const { pin } = verifyPinSchema.parse(req.body);
  const userId = req.user!.id;

  const isValid = await withTransaction(async (qr) => {
    return verifyPin(userId, pin, qr);
  });

  return ok(res, { isValid });
}