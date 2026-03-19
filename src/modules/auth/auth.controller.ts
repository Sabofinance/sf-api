import crypto from 'crypto';

import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../../config/env';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { created, ok } from '../../utils/apiResponse';
import { Currency, UserRole } from '../../utils/enums';
import { AppError, UnauthorizedError } from '../../utils/errors';

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

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

function signAccessToken(user: { id: string; name: string; email: string; role: UserRole; kyc_status: string }) {
  const payload = { id: user.id, name: user.name, email: user.email, role: user.role, kyc_status: user.kyc_status };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '15m' });
}

function signRefreshToken(user: { id: string; name: string; email: string; role: UserRole; kyc_status: string }) {
  const payload = { id: user.id, name: user.name, email: user.email, role: user.role, kyc_status: user.kyc_status };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
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

    const user = rows[0] as { id: string; role: UserRole; kyc_status: string };
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

  const user = result as unknown as { id: string; name: string; email: string; role: UserRole; kyc_status: string };

  // Send verification email
  const verificationToken = jwt.sign({ id: user.id, email: user.email, purpose: 'verify-email' }, env.JWT_SECRET, { expiresIn: '1h' });
  const verificationLink = `http://localhost:3000/auth/verify-email?token=${verificationToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Verify Your Email Address',
    template: 'email-verification',
    context: { name: user.name, verificationLink },
  });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

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
      `SELECT "id","password_hash","role","email","name","kyc_status" FROM "users" WHERE "email" = $1 LIMIT 1`,
      [input.email.toLowerCase()],
    )) as Array<{ id: string; password_hash: string; role: UserRole; email: string; name: string; kyc_status: string; }>;
  })) as Array<{ id: string; password_hash: string; role: UserRole; email: string; name: string; kyc_status: string; }>;

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
    template: 'otp',
    context: { otp },
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
      'SELECT "id", "name", "email", "role", "kyc_status" FROM "users" WHERE "email" = $1 AND "otp" = $2 AND "otp_expires" > NOW() LIMIT 1',
      [input.email.toLowerCase(), input.otp],
    )) as Array<{ id: string; name: string; email: string; role: UserRole; kyc_status: string }>;

    return rows[0];
  });

  if (!user) {
    throw new AppError('INVALID_OTP', 'OTP is invalid or has expired', 400);
  }

  await withTransaction(async (qr) => {
    await qr.query('UPDATE "users" SET "otp" = NULL, "otp_expires" = NULL WHERE "id" = $1', [
      user.id,
    ]);
  });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

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
    const rows = (await qr.query('SELECT "id", "name", "email" FROM "users" WHERE "email" = $1 LIMIT 1', [
      input.email.toLowerCase(),
    ])) as Array<{ id: string; name: string; email: string }>;

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
    const resetLink = `https://sabofinance.com/reset-password?token=${resetToken}`;
    await sendEmail({
      to: input.email.toLowerCase(),
      subject: 'Reset Your Password',
      template: 'forgot-password',
      context: { resetLink },
    });
    console.log(`Password reset link sent to ${input.email}: ${resetLink}`);
  });

  return ok(res, {
    message: 'If a user with that email exists, a password reset link has been sent.',
  });
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
      'SELECT "id", "name", "email" FROM "users" WHERE "password_reset_token" = $1 AND "password_reset_expires" > NOW() LIMIT 1',
      [password_reset_token],
    )) as Array<{ id: string; name: string; email: string }>;

    return rows[0];
  });

  if (!user) {
    throw new AppError('INVALID_TOKEN', 'Password reset token is invalid or has expired', 400);
  }

  const password_hash = await bcrypt.hash(input.password, 12);

  await withTransaction(async (qr) => {
    await qr.query(
      'UPDATE "users" SET "password_hash" = $1, "password_reset_token" = NULL, "password_reset_expires" = NULL WHERE "id" = $2',
      [password_hash, user.id,
    ]);

    await sendEmail({
      to: user.email,
      subject: 'Security Alert: Password Changed',
      template: 'security-alert',
      context: {
        name: user.name,
        message: 'Your password has been successfully changed. If you did not authorize this, please contact support immediately.',
      },
    });
  });

  return ok(res, { message: 'Password has been reset successfully.' });
}

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       401:
 *         description: Invalid refresh token
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function refreshToken(req: Request, res: Response) {
  const input = await refreshTokenSchema.parse(req.body);

  if (!input.refreshToken) {
    throw new AppError('REFRESH_TOKEN_MISSING', 'Refresh token is required', 400);
  }

  try {
    
    if (!env.JWT_REFRESH_SECRET)
      throw new AppError('CONFIG_ERROR', 'JWT_REFRESH_SECRET is required', 500);
    const payload = jwt.verify(input.refreshToken, env.JWT_REFRESH_SECRET) as {
      id: string;
      name: string;
      email: string;
      role: UserRole;
      kyc_status: string;
    };

    if (!payload.id || !payload.role) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token payload is invalid', 401);
    }

    // Optional: verify user exists
    const user = await withTransaction(async (qr) => {
      const rows = (await qr.query('SELECT "id", "name", "email", "role", "kyc_status" FROM "users" WHERE "id" = $1 LIMIT 1', [
        payload.id,
      ])) as Array<{ id: string; name: string; email: string; role: UserRole; kyc_status: string }>;
      return rows[0];
    });

    if (!user) throw new AppError('USER_NOT_FOUND', 'User not found', 401);

    // Issue new tokens
    const newAccessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user);

    return ok(res, { tokens: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
  } catch {
    throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired', 401);
  }
}
