import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { cloudinary } from '../../config/cloudinary';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { verifyPin } from '../../services/pinService';
import { ok } from '../../utils/apiResponse';
import { UserRole } from '../../utils/enums';
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

/**
 * @swagger
 * /account/profile/picture:
 *   post:
 *     summary: Update user profile picture
 *     tags: [Account]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Picture updated
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function updateProfilePicture(req: Request, res: Response) {
  const file = req.file as Express.Multer.File | undefined;
  if (!file) throw new AppError('FILE_REQUIRED', 'Profile picture file is required', 400);

  const uploaded = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`, {
    folder: 'sabo-finance/user-profile',
    resource_type: 'image',
  });

  const result = await withTransaction(async (qr) => {
    await qr.query(`UPDATE "users" SET "profile_picture_url" = $1 WHERE "id" = $2`, [
      uploaded.secure_url,
      req.user!.id,
    ]);

    await qr.query(
      `INSERT INTO "admin_logs" ("id", "admin_id", "action", "target_type", "target_id", "details", "created_at")
       VALUES (gen_random_uuid(), $1, 'PROFILE_PICTURE_UPDATED', 'user', $1, $2, now())`,
      [req.user!.id, JSON.stringify({ hasPicture: true })],
    );

    return { profile_picture_url: uploaded.secure_url };
  });

  return ok(res, { ...result });
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const accountDeletionInitiateSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

const accountDeletionConfirmSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

const emailChangeInitiateSchema = z.object({
  new_email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const emailChangeConfirmSchema = z.object({
  new_email: z.string().email('Invalid email address'),
  otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

/**
 * @swagger
 * /account/delete/initiate:
 *   post:
 *     summary: Initiate soft account deletion (sends OTP)
 *     tags: [Account]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string, example: "Password123!" }
 *     responses:
 *       200:
 *         description: OTP sent
 */
export async function initiateAccountDeletion(req: Request, res: Response) {
  const input = accountDeletionInitiateSchema.parse(req.body);
  const userId = req.user!.id;

  if (req.user!.role === UserRole.admin || req.user!.role === UserRole.super_admin) {
    throw new AppError('ADMIN_CANNOT_DELETE', 'Admin accounts cannot be self-deleted. Contact a super admin to remove this account.', 403);
  }

  const result = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","name","email","password_hash"
       FROM "users"
       WHERE "id" = $1 AND "deleted_at" IS NULL
       LIMIT 1
       FOR UPDATE`,
      [userId],
    )) as Array<{ id: string; name: string; email: string; password_hash: string }>;

    const user = rows[0];
    if (!user) throw new AppError('ACCOUNT_NOT_FOUND', 'We could not find an active account for this session.', 404);

    const okPass = await bcrypt.compare(input.password, user.password_hash);
    if (!okPass) throw new AppError('INVALID_PASSWORD', 'The password you entered is incorrect.', 401);

    const otp = generateOtp();
    const otp_expires = new Date(Date.now() + 10 * 60 * 1000);

    await qr.query(
      `UPDATE "users"
       SET "otp" = $1, "otp_expires" = $2, "otp_purpose" = $3, "otp_target_email" = NULL
       WHERE "id" = $4`,
      [otp, otp_expires, 'account-delete', userId],
    );

    return { name: user.name, email: user.email, otp };
  });

  await sendEmail({
    to: result.email,
    subject: 'Confirm Account Deletion - Sabo Finance',
    template: 'account-delete-otp',
    context: { name: result.name, otp: result.otp },
  });

  return ok(res, { message: 'Deletion OTP sent to your email.' });
}

/**
 * @swagger
 * /account/delete/confirm:
 *   post:
 *     summary: Confirm soft account deletion (password + OTP)
 *     tags: [Account]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password, otp]
 *             properties:
 *               password: { type: string, example: "Password123!" }
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: Account scheduled for deletion
 */
export async function confirmAccountDeletion(req: Request, res: Response) {
  const input = accountDeletionConfirmSchema.parse(req.body);
  const userId = req.user!.id;

  const result = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","name","email","password_hash","otp","otp_expires","otp_purpose" 
       FROM "users"
       WHERE "id" = $1 AND "deleted_at" IS NULL
       LIMIT 1
       FOR UPDATE`,
      [userId],
    )) as Array<{
      id: string;
      name: string;
      email: string;
      password_hash: string;
      otp: string | null;
      otp_expires: Date | null;
      otp_purpose: string | null;
    }>;

    const user = rows[0];
    if (!user) throw new AppError('ACCOUNT_NOT_FOUND', 'We could not find an active account for this session.', 404);

    const okPass = await bcrypt.compare(input.password, user.password_hash);
    if (!okPass) throw new AppError('INVALID_PASSWORD', 'The password you entered is incorrect.', 401);

    if (user.otp_purpose !== 'account-delete')
      throw new AppError('OTP_INVALID_PURPOSE', 'This code is not for account deletion. Start the deletion flow again from settings.', 400);
    if (!user.otp || !user.otp_expires)
      throw new AppError('OTP_NOT_ISSUED', 'No active deletion code found. Request a new OTP from account settings.', 400);
    if (user.otp_expires <= new Date()) throw new AppError('OTP_EXPIRED', 'This code has expired. Request a new deletion OTP.', 400);
    if (user.otp !== input.otp) throw new AppError('OTP_INCORRECT', 'The code does not match. Try again or request a new OTP.', 401);

    await qr.query(
      `UPDATE "users"
       SET "deleted_at" = now(),
           "is_suspended" = true,
           "otp" = NULL,
           "otp_expires" = NULL,
           "otp_purpose" = NULL,
           "otp_target_email" = NULL
       WHERE "id" = $1`,
      [userId],
    );

    await qr.query(
      `INSERT INTO "admin_logs" ("id","admin_id","action","target_type","target_id","details","created_at")
       VALUES (gen_random_uuid(), $1, 'ACCOUNT_DELETION_CONFIRMED', 'user', $1, $2, now())`,
      [userId, JSON.stringify({ email: user.email })],
    );

    return { name: user.name, email: user.email };
  });

  await sendEmail({
    to: result.email,
    subject: 'Account Deletion Confirmed - Sabo Finance',
    template: 'account-deletion-confirmed',
    context: { name: result.name },
  });

  return ok(res, { message: 'Your account has been deleted (soft delete).' });
}

/**
 * @swagger
 * /account/email-change/initiate:
 *   post:
 *     summary: Initiate email change (OTP sent to new email + alert old email)
 *     tags: [Account]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [new_email, password]
 *             properties:
 *               new_email: { type: string, example: "new@example.com" }
 *               password: { type: string, example: "Password123!" }
 *     responses:
 *       200:
 *         description: OTP sent to new email
 */
export async function initiateEmailChange(req: Request, res: Response) {
  const input = emailChangeInitiateSchema.parse(req.body);
  const userId = req.user!.id;
  const newEmail = input.new_email.toLowerCase();

  const result = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","name","email","password_hash" 
       FROM "users" 
       WHERE "id" = $1 AND "deleted_at" IS NULL
       LIMIT 1
       FOR UPDATE`,
      [userId],
    )) as Array<{ id: string; name: string; email: string; password_hash: string }>;

    const user = rows[0];
    if (!user) throw new AppError('ACCOUNT_NOT_FOUND', 'We could not find an active account for this session.', 404);
    if (user.email.toLowerCase() === newEmail) throw new AppError('EMAIL_NOT_CHANGED', 'New email must be different from your current email.', 400);

    const existing = await qr.query(`SELECT "id" FROM "users" WHERE "email" = $1 AND "id" != $2 AND "deleted_at" IS NULL LIMIT 1`, [
      newEmail,
      userId,
    ]);

    if ((existing as unknown[]).length > 0) throw new AppError('EMAIL_TAKEN', 'That email is already registered to another account.', 409);

    const okPass = await bcrypt.compare(input.password, user.password_hash);
    if (!okPass) throw new AppError('INVALID_PASSWORD', 'The password you entered is incorrect.', 401);

    const otp = generateOtp();
    const otp_expires = new Date(Date.now() + 10 * 60 * 1000);

    await qr.query(
      `UPDATE "users"
       SET "otp" = $1,
           "otp_expires" = $2,
           "otp_purpose" = $3,
           "otp_target_email" = $4
       WHERE "id" = $5`,
      [otp, otp_expires, 'email-change', newEmail, userId],
    );

    return { name: user.name, oldEmail: user.email, newEmail, otp };
  });

  await sendEmail({
    to: result.newEmail,
    subject: 'Verify Your New Email - Sabo Finance',
    template: 'email-change-otp',
    context: { name: result.name, otp: result.otp, oldEmail: result.oldEmail, newEmail: result.newEmail },
  });

  await sendEmail({
    to: result.oldEmail,
    subject: 'Email Change Requested',
    template: 'email-change-alert',
    context: { name: result.name, newEmail: result.newEmail },
  });

  await withTransaction(async (qr) => {
    await qr.query(
      `INSERT INTO "admin_logs" ("id","admin_id","action","target_type","target_id","details","created_at")
       VALUES (gen_random_uuid(), $1, 'EMAIL_CHANGE_INITIATED', 'user', $1, $2, now())`,
      [userId, JSON.stringify({ newEmail })],
    );
  });

  return ok(res, { message: 'OTP sent to your new email.' });
}

/**
 * @swagger
 * /account/email-change/confirm:
 *   post:
 *     summary: Confirm email change using OTP
 *     tags: [Account]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [new_email, otp]
 *             properties:
 *               new_email: { type: string, example: "new@example.com" }
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: Email changed successfully
 */
export async function confirmEmailChange(req: Request, res: Response) {
  const input = emailChangeConfirmSchema.parse(req.body);
  const userId = req.user!.id;
  const newEmail = input.new_email.toLowerCase();

  const result = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","name","email","otp","otp_expires","otp_purpose","otp_target_email" 
       FROM "users"
       WHERE "id" = $1 AND "deleted_at" IS NULL
       LIMIT 1
       FOR UPDATE`,
      [userId],
    )) as Array<{
      id: string;
      name: string;
      email: string;
      otp: string | null;
      otp_expires: Date | null;
      otp_purpose: string | null;
      otp_target_email: string | null;
    }>;

    const user = rows[0];
    if (!user) throw new AppError('ACCOUNT_NOT_FOUND', 'We could not find an active account for this session.', 404);

    if (user.otp_purpose !== 'email-change')
      throw new AppError('OTP_INVALID_PURPOSE', 'This code is not for an email change. Start the email change flow again.', 400);
    if (!user.otp || !user.otp_expires || !user.otp_target_email)
      throw new AppError('OTP_NOT_ISSUED', 'No active email-change code found. Request a new OTP to your new address.', 400);
    if (user.otp_expires <= new Date()) throw new AppError('OTP_EXPIRED', 'This code has expired. Request a new OTP to your new email.', 400);
    if (user.otp_target_email.toLowerCase() !== newEmail)
      throw new AppError('EMAIL_MISMATCH', 'The email you entered does not match the pending change. Use the same address you requested.', 400);
    if (user.otp !== input.otp) throw new AppError('OTP_INCORRECT', 'The code does not match. Try again or request a new OTP.', 401);

    await qr.query(
      `UPDATE "users"
       SET "email" = $1,
           "email_verified" = true,
           "otp" = NULL,
           "otp_expires" = NULL,
           "otp_purpose" = NULL,
           "otp_target_email" = NULL
       WHERE "id" = $2`,
      [newEmail, userId],
    );

    await qr.query(
      `INSERT INTO "admin_logs" ("id","admin_id","action","target_type","target_id","details","created_at")
       VALUES (gen_random_uuid(), $1, 'EMAIL_CHANGE_CONFIRMED', 'user', $1, $2, now())`,
      [userId, JSON.stringify({ email: newEmail })],
    );

    return { name: user.name, email: newEmail };
  });

  await sendEmail({
    to: result.email,
    subject: 'Email Updated Successfully - Sabo Finance',
    template: 'email-change-confirmed',
    context: { name: result.name },
  });

  return ok(res, { message: 'Email changed successfully.' });
}