import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../../config/env';
import { withTransaction } from '../../database/transaction';
import { Currency, UserRole } from '../../utils/enums';
import { created, ok } from '../../utils/apiResponse';
import { AppError, UnauthorizedError } from '../../utils/errors';
import { sendEmail } from '../../services/emailService';

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7).max(32),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8),
});

function signAccessToken(user: { id: string; role: UserRole }) {
  if (!env.JWT_SECRET) throw new AppError('CONFIG_ERROR', 'JWT_SECRET is required', 500);
  return jwt.sign({ role: user.role }, env.JWT_SECRET, { subject: user.id, expiresIn: '15m' });
}

function signRefreshToken(user: { id: string; role: UserRole }) {
  if (!env.JWT_REFRESH_SECRET) throw new AppError('CONFIG_ERROR', 'JWT_REFRESH_SECRET is required', 500);
  return jwt.sign({ role: user.role }, env.JWT_REFRESH_SECRET, { subject: user.id, expiresIn: '30d' });
}

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, phone, password]
 *             properties:
 *               name: { type: string, example: "Jane Doe" }
 *               email: { type: string, example: "jane@example.com" }
 *               phone: { type: string, example: "+2348000000000" }
 *               password: { type: string, example: "Password123!" }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  const password_hash = await bcrypt.hash(input.password, 12);

  const result = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `INSERT INTO "users" ("id","name","email","phone","password_hash","email_verified","phone_verified","kyc_status","role","is_suspended","created_at")
       VALUES (gen_random_uuid(), $1,$2,$3,$4,false,false,'unverified',$5,false, now())
       RETURNING "id","name","email","phone","email_verified","phone_verified","kyc_status","role","is_suspended","created_at"`,
      [input.name, input.email.toLowerCase(), input.phone, password_hash, UserRole.user],
    )) as Array<Record<string, unknown>>;

    const user = rows[0] as { id: string; role: UserRole };
    const currencies = [Currency.NGN, Currency.GBP, Currency.USD, Currency.CAD] as const;
    for (const currency of currencies) {
      await qr.query(
        `INSERT INTO "wallets" ("id","user_id","currency","balance","locked_balance","updated_at")
         VALUES (gen_random_uuid(), $1,$2,0,0, now())`,
        [user.id, currency],
      );
    }

    return rows[0];
  });

  const user = result as any;
  const accessToken = signAccessToken({ id: user.id, role: user.role });
  const refreshToken = signRefreshToken({ id: user.id, role: user.role });

  return created(res, { user, tokens: { accessToken, refreshToken } });
}

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: "jane@example.com" }
 *               password: { type: string, example: "Password123!" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);

  const rows = (await withTransaction(async (qr) => {
    return (await qr.query(
      `SELECT "id","password_hash","role","email" FROM "users" WHERE "email" = $1 LIMIT 1`,
      [input.email.toLowerCase()],
    )) as Array<{ id: string; password_hash: string; role: UserRole; email: string }>;
  })) as Array<{ id: string; password_hash: string; role: UserRole; email: string }>;

  const user = rows[0];
  if (!user) throw new UnauthorizedError('Invalid credentials');

  const okPass = await bcrypt.compare(input.password, user.password_hash);
  if (!okPass) throw new UnauthorizedError('Invalid credentials');

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otp_expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await withTransaction(async (qr) => {
    await qr.query('UPDATE "users" SET "otp" = $1, "otp_expires" = $2 WHERE "id" = $3', [
      otp,
      otp_expires,
      user.id,
    ]);
  });

  await sendEmail({
    to: user.email,
    subject: 'Your OTP for Sabo Finance',
    text: `Your OTP is ${otp}`,
    html: `<b>Your OTP is ${otp}</b>`,
  });

  return ok(res, { message: 'An OTP has been sent to your email.' });
}

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Verify OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, example: "jane@example.com" }
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       400:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function verifyOtp(req: Request, res: Response) {
  const input = verifyOtpSchema.parse(req.body);

  const user = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      'SELECT "id", "role" FROM "users" WHERE "email" = $1 AND "otp" = $2 AND "otp_expires" > NOW() LIMIT 1',
      [input.email.toLowerCase(), input.otp],
    )) as Array<{ id: string; role: UserRole }>;

    return rows[0];
  });

  if (!user) {
    throw new AppError('INVALID_OTP', 'OTP is invalid or has expired', 400);
  }

  await withTransaction(async (qr) => {
    await qr.query('UPDATE "users" SET "otp" = NULL, "otp_expires" = NULL WHERE "id" = $1', [user.id]);
  });

  const accessToken = signAccessToken({ id: user.id, role: user.role });
  const refreshToken = signRefreshToken({ id: user.id, role: user.role });

  return ok(res, { tokens: { accessToken, refreshToken } });
}

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout (client-side token discard)
 *     tags: [Auth]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function logout(_req: Request, res: Response) {
  return ok(res, { loggedOut: true });
}

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Forgot password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, example: "jane@example.com" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function forgotPassword(req: Request, res: Response) {
  const input = forgotPasswordSchema.parse(req.body);

  await withTransaction(async (qr) => {
    const rows = (await qr.query('SELECT "id" FROM "users" WHERE "email" = $1 LIMIT 1', [
      input.email.toLowerCase(),
    ])) as Array<{ id: string }>;

    const user = rows[0];
    if (!user) return;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const password_reset_token = crypto.createHash('sha256').update(resetToken).digest('hex');
    const password_reset_expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await qr.query(
      'UPDATE "users" SET "password_reset_token" = $1, "password_reset_expires" = $2 WHERE "id" = $3',
      [password_reset_token, password_reset_expires, user.id],
    );

    // In a real application, you would send an email with the resetToken
    console.log(`Password reset token for ${input.email}: ${resetToken}`);
  });

  return ok(res, { message: 'If a user with that email exists, a password reset link has been sent.' });
}

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string, example: "..." }
 *               password: { type: string, example: "NewPassword123!" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       400:
 *         description: Invalid or expired token
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function resetPassword(req: Request, res: Response) {
  const input = resetPasswordSchema.parse(req.body);
  const password_reset_token = crypto.createHash('sha256').update(input.token).digest('hex');

  const user = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      'SELECT "id" FROM "users" WHERE "password_reset_token" = $1 AND "password_reset_expires" > NOW() LIMIT 1',
      [password_reset_token],
    )) as Array<{ id: string }>;

    return rows[0];
  });

  if (!user) {
    throw new AppError('INVALID_TOKEN', 'Password reset token is invalid or has expired', 400);
  }

  const password_hash = await bcrypt.hash(input.password, 12);

  await withTransaction(async (qr) => {
    await qr.query(
      'UPDATE "users" SET "password_hash" = $1, "password_reset_token" = NULL, "password_reset_expires" = NULL WHERE "id" = $2',
      [password_hash, user.id],
    );
  });

  return ok(res, { message: 'Password has been reset successfully.' });
}

