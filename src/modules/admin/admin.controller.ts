import crypto from 'crypto';

import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../../config/env';
import { cloudinary } from '../../config/cloudinary';
import { Deposit } from '../../database/entities/Deposit';
import { Dispute } from '../../database/entities/Dispute';
import { Kyc } from '../../database/entities/Kyc';
import { Sabit } from '../../database/entities/Sabit';
import { Trade } from '../../database/entities/Trade';
import { User } from '../../database/entities/User';
import { Withdrawal } from '../../database/entities/Withdrawal';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { NotificationService } from '../../services/notificationService';
import { generateUsername } from '../../services/usernameService';
import { WalletService } from '../../services/walletService';
import { ok } from '../../utils/apiResponse';
import {
  Currency,
  DepositStatus,
  DisputeStatus,
  KycStatus,
  LedgerType,
  NotificationType,
  TradeStatus,
  UserRole,
  WithdrawalStatus,
} from '../../utils/enums';
import { AppError, NotFoundError } from '../../utils/errors';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

function signAdminAccessToken(user: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  kyc_status: string;
}) {
  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    kyc_status: user.kyc_status,
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '8h' });
}

function signAdminRefreshToken(user: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  kyc_status: string;
}) {
  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    kyc_status: user.kyc_status,
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

/**
 * @swagger
 * /admin/auth/login:
 *   post:
 *     summary: Admin login (Step 1 - Password)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: "admin@example.com" }
 *               password: { type: string, example: "AdminPass123!" }
 *     responses:
 *       200:
 *         description: OK
 */
export async function adminLogin(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);

  const user = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","password_hash","role","email","name","kyc_status","is_suspended","deleted_at" FROM "users" WHERE "email" = $1 AND ("role" = $2 OR "role" = $3) LIMIT 1`,
      [input.email.toLowerCase(), UserRole.admin, UserRole.super_admin],
    )) as Array<{
      id: string;
      password_hash: string;
      role: UserRole;
      email: string;
      name: string;
      kyc_status: string;
      is_suspended: boolean;
      deleted_at: Date | null;
    }>;
    return rows[0];
  });

  if (!user)
    throw new AppError('INVALID_ADMIN_CREDENTIALS', 'Invalid admin email or password.', 401);
  if (user.deleted_at) throw new AppError('ACCOUNT_DELETED', 'This account has been deleted.', 401);
  if (user.is_suspended) throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.', 401);

  const okPass = await bcrypt.compare(input.password, user.password_hash);
  if (!okPass)
    throw new AppError('INVALID_ADMIN_CREDENTIALS', 'Invalid admin email or password.', 401);

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otp_expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await withTransaction(async (qr) => {
    await qr.query(
      'UPDATE "users" SET "otp" = $1, "otp_expires" = $2, "otp_purpose" = $3, "otp_target_email" = NULL WHERE "id" = $4',
      [otp, otp_expires, 'admin-login', user.id],
    );
  });

  await sendEmail({
    to: user.email,
    subject: 'Admin Login OTP - Sabo Finance',
    template: 'otp',
    context: { otp },
  });

  return ok(res, { message: 'An OTP has been sent to your admin email.' });
}

/**
 * @swagger
 * /admin/auth/verify-otp:
 *   post:
 *     summary: Admin login (Step 2 - OTP)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, example: "admin@example.com" }
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: OK
 */
export async function adminVerifyOtp(req: Request, res: Response) {
  const input = verifyOtpSchema.parse(req.body);

  const user = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      'SELECT "id", "name", "email", "role", "kyc_status", "is_suspended", "deleted_at" FROM "users" WHERE "email" = $1 AND ("role" = $2 OR "role" = $3) AND "otp" = $4 AND "otp_purpose" = $5 AND "otp_expires" > NOW() LIMIT 1',
      [input.email.toLowerCase(), UserRole.admin, UserRole.super_admin, input.otp, 'admin-login'],
    )) as Array<{
      id: string;
      name: string;
      email: string;
      role: UserRole;
      kyc_status: string;
      is_suspended: boolean;
      deleted_at: Date | null;
    }>;

    return rows[0];
  });

  if (!user) {
    throw new AppError(
      'INVALID_OTP',
      'That admin sign-in code is incorrect or has expired. Request a new OTP.',
      400,
    );
  }
  if (user.deleted_at) throw new AppError('ACCOUNT_DELETED', 'This account has been deleted.', 401);
  if (user.is_suspended) throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.', 401);

  await withTransaction(async (qr) => {
    await qr.query(
      'UPDATE "users" SET "otp" = NULL, "otp_expires" = NULL, "otp_purpose" = NULL, "otp_target_email" = NULL WHERE "id" = $1',
      [user.id],
    );
  });

  const accessToken = signAdminAccessToken(user);
  const refreshToken = signAdminRefreshToken(user);

  return ok(res, {
    tokens: { accessToken, refreshToken },
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}

const idSchema = z.object({ id: z.string().uuid() });
const paginationSchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
});

const rejectKycSchema = z.object({
  reason: z.string().min(10),
});

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List all users
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listUsers(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const { users, total } = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query('SELECT COUNT(*) as total FROM "users"')) as [
      { total: string },
    ];
    const users = (await qr.query(
      `SELECT * FROM "users" ORDER BY "created_at" DESC LIMIT $1 OFFSET $2`,
      [limitNum, offset],
    )) as User[];
    return { users, total: parseInt(total) };
  });
  return ok(res, { items: users, total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /admin/users/{id}:
 *   get:
 *     summary: Get a specific user and their wallets
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getUser(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  const user = await withTransaction(async (qr) => {
    const userRows = (await qr.query(`SELECT * FROM "users" WHERE "id" = $1`, [id])) as User[];
    if (userRows.length === 0)
      throw new NotFoundError('No user exists with that ID.', 'USER_NOT_FOUND');
    const wallets = await qr.query(`SELECT * FROM "wallets" WHERE "user_id" = $1`, [id]);
    return { ...userRows[0], wallets };
  });
  return ok(res, { user });
}

/**
 * @swagger
 * /admin/users/{id}/suspend:
 *   post:
 *     summary: Suspend a user account
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function suspendUser(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  await withTransaction(async (qr) => {
    await qr.query(`UPDATE "users" SET "is_suspended" = true WHERE "id" = $1`, [id]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: id,
      title: 'Account Suspended',
      message: 'Your account has been suspended. Please contact support.',
      type: NotificationType.error,
    });
  });
  return ok(res, { message: 'User suspended successfully' });
}

/**
 * @swagger
 * /admin/users/{id}/reinstate:
 *   post:
 *     summary: Reinstate a suspended user account
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function reinstateUser(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  await withTransaction(async (qr) => {
    await qr.query(`UPDATE "users" SET "is_suspended" = false WHERE "id" = $1`, [id]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: id,
      title: 'Account Reinstated',
      message: 'Your account has been reinstated. You can now use the platform.',
      type: NotificationType.success,
    });
  });
  return ok(res, { message: 'User reinstated successfully' });
}

/**
 * @swagger
 * /admin/kyc:
 *   get:
 *     summary: List all KYC submissions
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listKycSubmissions(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const { submissions, total } = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query('SELECT COUNT(*) as total FROM "kyc"')) as [
      { total: string },
    ];
    const submissions = (await qr.query(
      `SELECT 
        k.*, 
        u.name, 
        u.username, 
        u.email, 
        u.phone, 
        u.profile_picture_url 
      FROM "kyc" k 
      JOIN "users" u ON k.user_id = u.id 
      ORDER BY k.created_at DESC 
      LIMIT $1 OFFSET $2`,
      [limitNum, offset],
    )) as Array<
      Kyc & {
        name: string;
        username: string;
        email: string;
        phone: string;
        profile_picture_url: string | null;
      }
    >;
    return { submissions, total: parseInt(total) };
  });
  return ok(res, { items: submissions, total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /admin/kyc/{id}/approve:
 *   post:
 *     summary: Approve a KYC submission
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function approveKyc(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  await withTransaction(async (qr) => {
    const kycRows = (await qr.query(`SELECT * FROM "kyc" WHERE "id" = $1 FOR UPDATE`, [
      id,
    ])) as Kyc[];
    const kyc = kycRows[0];
    if (!kyc) throw new NotFoundError('KYC submission not found');

    await qr.query(
      `UPDATE "kyc" SET "status" = $1, "reviewed_by" = $2, "reviewed_at" = NOW() WHERE "id" = $3`,
      [KycStatus.verified, req.user!.id, id],
    );
    await qr.query(`UPDATE "users" SET "kyc_status" = $1 WHERE "id" = $2`, [
      KycStatus.verified,
      kyc.user_id,
    ]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: kyc.user_id,
      title: 'KYC Approved',
      message: 'Your KYC documents have been approved. You now have full access to the platform.',
      type: NotificationType.success,
      relatedId: id,
    });

    const user = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [
      kyc.user_id,
    ])) as User[];
    await sendEmail({
      to: user[0].email,
      subject: 'KYC Approved',
      template: 'kyc-update',
      context: {
        name: user[0].name,
        status: 'Approved',
        statusClass: 'approved',
        message: 'Your KYC documents have been approved. You now have full access to the platform.',
      },
    });
  });
  return ok(res, { message: 'KYC approved successfully' });
}

/**
 * @swagger
 * /admin/kyc/{id}/reject:
 *   post:
 *     summary: Reject a KYC submission
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, example: "Document is not clear" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function rejectKyc(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  const { reason } = rejectKycSchema.parse(req.body);

  await withTransaction(async (qr) => {
    const kycRows = (await qr.query(`SELECT * FROM "kyc" WHERE "id" = $1 FOR UPDATE`, [
      id,
    ])) as Kyc[];
    const kyc = kycRows[0];
    if (!kyc) throw new NotFoundError('KYC submission not found');

    await qr.query(
      `UPDATE "kyc" SET "status" = $1, "rejection_reason" = $2, "reviewed_by" = $3, "reviewed_at" = NOW() WHERE "id" = $4`,
      [KycStatus.rejected, reason, req.user!.id, id],
    );
    await qr.query(`UPDATE "users" SET "kyc_status" = $1 WHERE "id" = $2`, [
      KycStatus.rejected,
      kyc.user_id,
    ]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: kyc.user_id,
      title: 'KYC Rejected',
      message: `Your KYC submission was rejected: ${reason}`,
      type: NotificationType.error,
      relatedId: id,
    });

    const user = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [
      kyc.user_id,
    ])) as User[];
    await sendEmail({
      to: user[0].email,
      subject: 'KYC Rejected',
      template: 'kyc-update',
      context: {
        name: user[0].name,
        status: 'Rejected',
        statusClass: 'rejected',
        message: `Your KYC submission was rejected for the following reason: ${reason}`,
      },
    });
  });

  return ok(res, { message: 'KYC rejected successfully' });
}

/**
 * @swagger
 * /admin/deposits/{id}/approve:
 *   post:
 *     summary: Approve a manual foreign deposit and credit wallet
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function approveDeposit(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);

  const walletService = new WalletService();
  const deposit = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1 FOR UPDATE`, [
      id,
    ])) as Deposit[];
    const dep = rows[0];
    if (!dep) throw new NotFoundError('Deposit not found');

    if (dep.status === DepositStatus.completed) return dep;
    // We want to allow admins to approve deposits that are either pending_review (manual foreign deposits)
    // or initiated (NGN deposits where webhook failed but admin verified the payment).
    if (dep.status !== DepositStatus.pending_review && dep.status !== DepositStatus.initiated) {
      throw new AppError('INVALID_STATUS', 'Deposit is not pending review or initiated', 400);
    }

    await walletService.credit({
      queryRunner: qr,
      userId: dep.user_id,
      currency: dep.currency,
      amount: dep.amount,
      type: LedgerType.deposit,
      initiatedBy: req.user!.id,
      relatedId: dep.id,
      reference: dep.reference,
    });

    await qr.query(
      `UPDATE "deposits" SET "status" = $1, "reviewed_by" = $2, "reviewed_at" = NOW() WHERE "id" = $3`,
      [DepositStatus.completed, req.user!.id, dep.id],
    );

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: dep.user_id,
      title: 'Deposit Confirmed',
      message: `Your deposit of ${dep.amount} ${dep.currency} has been approved and credited.`,
      type: NotificationType.success,
      relatedId: dep.id,
    });

    const updated = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1`, [
      dep.id,
    ])) as Deposit[];

    const user = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [
      dep.user_id,
    ])) as User[];
    await sendEmail({
      to: user[0].email,
      subject: 'Deposit Confirmed',
      template: 'deposit-confirmation',
      context: {
        name: user[0].name,
        amount: dep.amount,
        currency: dep.currency,
        reference: dep.reference,
      },
    });

    return updated[0];
  });

  return ok(res, { deposit });
}

export async function listAllWithdrawals(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const { withdrawals, total } = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query('SELECT COUNT(*) as total FROM "withdrawals"')) as [
      { total: string },
    ];
    const withdrawals = (await qr.query(
      `SELECT w.*, u.name as user_name, u.email as user_email, b.bank_name, b.account_name, b.account_number, b.sort_code, b.iban
       FROM "withdrawals" w
       JOIN "users" u ON w.user_id = u.id
       JOIN "beneficiaries" b ON w.beneficiary_id = b.id
       ORDER BY w.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limitNum, offset],
    )) as Array<Record<string, unknown>>;
    return { withdrawals, total: parseInt(total) };
  });
  return ok(res, { items: withdrawals, total, page: pageNum, limit: limitNum });
}

export async function approveWithdrawal(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);

  const withdrawal = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "withdrawals" WHERE "id" = $1 LIMIT 1 FOR UPDATE`, [
      id,
    ])) as Withdrawal[];
    const wdr = rows[0];
    if (!wdr) throw new NotFoundError('Withdrawal not found');

    if (wdr.status === WithdrawalStatus.completed) return wdr;
    if (wdr.status !== WithdrawalStatus.requested && wdr.status !== WithdrawalStatus.processing) {
      throw new AppError(
        'INVALID_STATUS',
        'Withdrawal is not in a state that can be approved',
        400,
      );
    }

    await qr.query(
      `UPDATE "withdrawals" SET "status" = $1, "reviewed_by" = $2, "reviewed_at" = NOW() WHERE "id" = $3`,
      [WithdrawalStatus.completed, req.user!.id, id],
    );

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: wdr.user_id,
      title: 'Withdrawal Completed',
      message: `Your withdrawal of ${wdr.amount} ${wdr.currency} has been processed and sent to your bank.`,
      type: NotificationType.success,
      relatedId: id,
    });

    const updated = (await qr.query(`SELECT * FROM "withdrawals" WHERE "id" = $1 LIMIT 1`, [
      id,
    ])) as Withdrawal[];

    const user = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [
      wdr.user_id,
    ])) as User[];
    await sendEmail({
      to: user[0].email,
      subject: 'Withdrawal Completed',
      template: 'withdrawal-update',
      context: {
        name: user[0].name,
        amount: wdr.amount,
        currency: wdr.currency,
        status: 'Completed',
        reference: wdr.reference,
      },
    });

    return updated[0];
  });

  return ok(res, { withdrawal });
}

export async function rejectWithdrawal(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);

  const walletService = new WalletService();
  const withdrawal = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "withdrawals" WHERE "id" = $1 LIMIT 1 FOR UPDATE`, [
      id,
    ])) as Withdrawal[];
    const wdr = rows[0];
    if (!wdr) throw new NotFoundError('Withdrawal not found');

    if (wdr.status === WithdrawalStatus.completed) {
      throw new AppError('INVALID_STATUS', 'Cannot reject a completed withdrawal', 400);
    }
    if (wdr.status === WithdrawalStatus.failed) {
      throw new AppError('INVALID_STATUS', 'Withdrawal is already failed/rejected', 400);
    }

    // Refund the user's wallet
    await walletService.credit({
      queryRunner: qr,
      userId: wdr.user_id,
      currency: wdr.currency,
      amount: wdr.amount,
      type: LedgerType.reversal,
      initiatedBy: req.user!.id,
      relatedId: wdr.id,
      reference: `REJ-${wdr.reference}`,
    });

    await qr.query(
      `UPDATE "withdrawals" SET "status" = $1, "rejection_reason" = $2, "reviewed_by" = $3, "reviewed_at" = NOW() WHERE "id" = $4`,
      [WithdrawalStatus.failed, reason, req.user!.id, id],
    );

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: wdr.user_id,
      title: 'Withdrawal Rejected',
      message: `Your withdrawal of ${wdr.amount} ${wdr.currency} was rejected. Funds have been returned to your wallet. Reason: ${reason}`,
      type: NotificationType.error,
      relatedId: id,
    });

    const updated = (await qr.query(`SELECT * FROM "withdrawals" WHERE "id" = $1 LIMIT 1`, [
      id,
    ])) as Withdrawal[];
    return updated[0];
  });

  return ok(res, { withdrawal });
}

/**
 * @swagger
 * /admin/deposits/{id}/verify-flutterwave:
 *   post:
 *     summary: Manually verify and credit an initiated Flutterwave NGN deposit
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function verifyFlutterwaveDeposit(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);

  const walletService = new WalletService();

  const deposit = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1 FOR UPDATE`, [
      id,
    ])) as Deposit[];
    const dep = rows[0];
    if (!dep) throw new NotFoundError('Deposit not found');

    if (dep.status === DepositStatus.completed) return dep;

    if (dep.status !== DepositStatus.initiated) {
      throw new AppError(
        'INVALID_STATUS',
        'Only initiated deposits can be verified with Flutterwave',
        400,
      );
    }

    if (dep.currency !== Currency.NGN) {
      throw new AppError(
        'INVALID_CURRENCY',
        'Only NGN deposits can be verified with Flutterwave',
        400,
      );
    }

    // Verify via Flutterwave Verification API
    if (env.FLUTTERWAVE_SECRET) {
      try {
        // Flutterwave has an endpoint to verify transactions by tx_ref
        const response = await fetch(
          `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${dep.reference}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${env.FLUTTERWAVE_SECRET}`,
              'Content-Type': 'application/json',
            },
          },
        );

        const result = await response.json();

        if (!response.ok || result.status !== 'success') {
          throw new AppError(
            'VERIFICATION_FAILED',
            `Flutterwave Verification Failed: ${result.message || 'Transaction not found or successful'}`,
            400,
          );
        }

        // Ensure the amount and currency match
        if (result.data.status !== 'successful') {
          throw new AppError(
            'VERIFICATION_FAILED',
            `Transaction status is ${result.data.status}, expected successful`,
            400,
          );
        }

        if (Number(result.data.amount) < Number(dep.amount)) {
          throw new AppError(
            'VERIFICATION_FAILED',
            `Amount mismatch. Paid: ${result.data.amount}, Expected: ${dep.amount}`,
            400,
          );
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          'VERIFICATION_ERROR',
          'Could not verify transaction with Flutterwave',
          500,
        );
      }
    } else {
      // If no Flutterwave secret is configured (e.g. testing), we'll bypass actual verification
      // and proceed with manual crediting based on admin's trust.
      console.warn(
        'FLUTTERWAVE_SECRET not found, bypassing actual API verification for manual deposit approval.',
      );
    }

    await walletService.credit({
      queryRunner: qr,
      userId: dep.user_id,
      currency: dep.currency,
      amount: dep.amount,
      type: LedgerType.deposit,
      initiatedBy: req.user!.id,
      relatedId: dep.id,
      reference: dep.reference,
    });

    await qr.query(
      `UPDATE "deposits" SET "status" = $1, "reviewed_by" = $2, "reviewed_at" = NOW() WHERE "id" = $3`,
      [DepositStatus.completed, req.user!.id, dep.id],
    );

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: dep.user_id,
      title: 'Deposit Confirmed',
      message: `Your deposit of ${dep.amount} ${dep.currency} has been approved and credited.`,
      type: NotificationType.success,
      relatedId: dep.id,
    });

    const updated = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1`, [
      dep.id,
    ])) as Deposit[];

    const user = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [
      dep.user_id,
    ])) as User[];
    await sendEmail({
      to: user[0].email,
      subject: 'Deposit Confirmed',
      template: 'deposit-confirmation',
      context: {
        name: user[0].name,
        amount: dep.amount,
        currency: dep.currency,
        reference: dep.reference,
      },
    });

    return updated[0];
  });

  return ok(res, { deposit });
}

/**
 * @swagger
 * /admin/dashboard:
 *   get:
 *     summary: Get platform analytics and dashboard stats
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getDashboardStats(req: Request, res: Response) {
  const stats = await withTransaction(async (qr) => {
    // User counts
    const userStats = await qr.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_suspended = false) as active,
        COUNT(*) FILTER (WHERE is_suspended = true) as suspended
      FROM "users"
    `);

    // KYC counts
    const kycStats = await qr.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'verified') as verified,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected
      FROM "kyc"
    `);

    // Pending actions
    const pendingDeposits = await qr.query(`
      SELECT id, amount, currency, rejection_reason, created_at 
      FROM "deposits" 
      WHERE status = 'pending_review' 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    // Financial Metrics (Total Volumes by Currency)
    const depositVolumes = await qr.query(`
      SELECT currency, SUM(amount) as total_volume
      FROM "deposits"
      WHERE status = 'completed'
      GROUP BY currency
    `);

    const withdrawalVolumes = await qr.query(`
      SELECT currency, SUM(amount) as total_volume
      FROM "withdrawals"
      WHERE status = 'completed'
      GROUP BY currency
    `);

    const tradeVolumes = await qr.query(`
      SELECT currency, SUM(amount) as total_foreign_volume, SUM(total_ngn) as total_ngn_volume, COUNT(*) as total_trades
      FROM "trades"
      WHERE status = 'completed'
      GROUP BY currency
    `);

    const escrowTVL = await qr.query(`
      SELECT currency, SUM(escrow_balance) as total_locked
      FROM "wallets"
      WHERE escrow_balance > 0
      GROUP BY currency
    `);

    // P2P/Marketplace Metrics
    const sabitStats = await qr.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'completed') as completed
      FROM "sabits"
    `);

    const disputeStats = await qr.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved
      FROM "disputes"
    `);

    const recentKyc = await qr.query(`
      SELECT 
        k.id, 
        k.status, 
        k.document_type, 
        u.name as user_name, 
        u.username as user_username, 
        u.profile_picture_url as user_profile_picture
      FROM "kyc" k
      JOIN "users" u ON k.user_id = u.id
      ORDER BY k.created_at DESC
      LIMIT 5
    `);

    // Charts: Last 7 days KYC submissions
    const kycChart = await qr.query(`
      SELECT 
        TO_CHAR(day, 'Dy') as label,
        COALESCE(COUNT(k.id), 0) as value
      FROM generate_series(now() - interval '6 days', now(), interval '1 day') day
      LEFT JOIN "kyc" k ON date_trunc('day', k.created_at) = date_trunc('day', day)
      GROUP BY day
      ORDER BY day ASC
    `);

    // Charts: Last 7 days Deposits
    const depositChart = await qr.query(`
      SELECT 
        TO_CHAR(day, 'Dy') as label,
        COALESCE(COUNT(d.id), 0) as value
      FROM generate_series(now() - interval '6 days', now(), interval '1 day') day
      LEFT JOIN "deposits" d ON date_trunc('day', d.created_at) = date_trunc('day', day)
      GROUP BY day
      ORDER BY day ASC
    `);

    // Charts: Last 7 days Trades
    const tradeChart = await qr.query(`
      SELECT 
        TO_CHAR(day, 'Dy') as label,
        COALESCE(COUNT(t.id), 0) as value
      FROM generate_series(now() - interval '6 days', now(), interval '1 day') day
      LEFT JOIN "trades" t ON date_trunc('day', t.created_at) = date_trunc('day', day) AND t.status = 'completed'
      GROUP BY day
      ORDER BY day ASC
    `);

    return {
      users: userStats[0],
      kyc: kycStats[0],
      marketplace: {
        sabits: sabitStats[0],
        disputes: disputeStats[0],
      },
      financials: {
        depositVolumes,
        withdrawalVolumes,
        tradeVolumes,
        escrowTVL,
      },
      pendingDeposits,
      recentKyc,
      charts: {
        kycSubmissions: kycChart,
        deposits: depositChart,
        trades: tradeChart,
      },
    };
  });

  return ok(res, stats);
}

/**
 * @swagger
 * /admin/analytics/impact:
 *   get:
 *     summary: Get high-level platform impact and efficiency metrics
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getImpactAnalytics(req: Request, res: Response) {
  const impact = await withTransaction(async (qr) => {
    // 1. All-Time System Volume (Proof of Scale)
    // We sum absolute amounts from the ledger to show total money moved
    const allTimeLedgerVolume = await qr.query(`
      SELECT currency, SUM(amount) as total_processed
      FROM "ledger"
      WHERE status = 'completed'
      GROUP BY currency
    `);

    // 2. User Growth Velocity (Traction)
    const userGrowth = await qr.query(`
      WITH recent AS (
        SELECT COUNT(*) as recent_count FROM "users" WHERE created_at >= NOW() - INTERVAL '30 days'
      ),
      previous AS (
        SELECT COUNT(*) as prev_count FROM "users" WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days'
      )
      SELECT recent_count, prev_count, 
             CASE WHEN prev_count = 0 THEN 100 
             ELSE ROUND(((recent_count::numeric - prev_count::numeric) / prev_count::numeric) * 100, 2) 
             END as growth_percentage
      FROM recent, previous
    `);

    // 3. Trust & Safety Metrics (Product Quality)
    const tradeSafety = await qr.query(`
      SELECT 
        COUNT(*) as total_trades,
        COUNT(*) FILTER (WHERE status = 'completed') as successful_trades,
        COUNT(*) FILTER (WHERE status = 'disputed') as disputed_trades,
        ROUND((COUNT(*) FILTER (WHERE status = 'disputed')::numeric / NULLIF(COUNT(*), 0)::numeric) * 100, 2) as dispute_rate_percentage
      FROM "trades"
    `);

    // 4. Operational Efficiency
    // Since we don't track 'reviewed_at' on KYC explicitly, we proxy it by looking at Admin Logs for KYC actions
    const operationalEfficiency = await qr.query(`
      SELECT COUNT(*) as total_admin_actions
      FROM "admin_logs"
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    return {
      scale: {
        allTimeLedgerVolume,
      },
      traction: {
        userGrowth30Days: userGrowth[0],
      },
      trustAndSafety: {
        tradeSafety: tradeSafety[0],
      },
      efficiency: {
        adminActions30Days: operationalEfficiency[0].total_admin_actions,
      },
    };
  });

  return ok(res, impact);
}

/**
 * @swagger
 * /admin/trades:
 *   get:
 *     summary: List all trades across the platform
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listAllTrades(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const { trades, total } = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query('SELECT COUNT(*) as total FROM "trades"')) as [
      { total: string },
    ];
    const trades = (await qr.query(
      `SELECT t.*, b.name as buyer_name, s.name as seller_name 
       FROM "trades" t 
       JOIN "users" b ON t.buyer_id = b.id 
       JOIN "users" s ON t.seller_id = s.id 
       ORDER BY t.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limitNum, offset],
    )) as Array<Record<string, unknown>>;
    return { trades, total: parseInt(total) };
  });
  return ok(res, { items: trades, total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /admin/deposits:
 *   get:
 *     summary: List all deposits across the platform
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listAllDeposits(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const { deposits, total } = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query('SELECT COUNT(*) as total FROM "deposits"')) as [
      { total: string },
    ];
    const deposits = (await qr.query(
      `SELECT d.*, u.name as user_name, u.email as user_email 
       FROM "deposits" d 
       JOIN "users" u ON d.user_id = u.id 
       ORDER BY d.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limitNum, offset],
    )) as Array<Record<string, unknown>>;
    return { deposits, total: parseInt(total) };
  });
  return ok(res, { items: deposits, total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /admin/disputes:
 *   get:
 *     summary: List all disputes across the platform
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listAllDisputes(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const { disputes, total } = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query('SELECT COUNT(*) as total FROM "disputes"')) as [
      { total: string },
    ];
    const disputes = (await qr.query(
      `SELECT d.*, t.reference as trade_reference, u.name as raised_by_name 
       FROM "disputes" d 
       JOIN "trades" t ON d.trade_id = t.id 
       JOIN "users" u ON d.raised_by_id = u.id 
       ORDER BY d.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limitNum, offset],
    )) as Array<Record<string, unknown>>;
    return { disputes, total: parseInt(total) };
  });
  return ok(res, { items: disputes, total, page: pageNum, limit: limitNum });
}

const resolveDisputeSchema = z.object({
  favor: z.enum(['buyer', 'seller']),
  notes: z.string().min(10),
});

/**
 * @swagger
 * /admin/disputes/{id}/resolve:
 *   post:
 *     summary: Resolve a dispute (Admin only)
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [favor, notes]
 *             properties:
 *               favor: { type: string, enum: [buyer, seller] }
 *               notes: { type: string, example: "Buyer provided valid payment proof." }
 *     responses:
 *       200:
 *         description: Dispute resolved
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function resolveDispute(req: Request, res: Response) {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { favor, notes } = resolveDisputeSchema.parse(req.body);

  const walletService = new WalletService();

  const result = await withTransaction(async (qr) => {
    const disputeRows = (await qr.query(`SELECT * FROM "disputes" WHERE "id" = $1 FOR UPDATE`, [
      id,
    ])) as Dispute[];
    const dispute = disputeRows[0];
    if (!dispute) throw new NotFoundError('No dispute exists with that ID.', 'DISPUTE_NOT_FOUND');
    if (dispute.status !== DisputeStatus.open) {
      throw new AppError('INVALID_STATUS', 'This dispute has already been resolved.', 400);
    }

    const tradeRows = (await qr.query(`SELECT * FROM "trades" WHERE "id" = $1 FOR UPDATE`, [
      dispute.trade_id,
    ])) as Trade[];
    const trade = tradeRows[0];
    if (!trade)
      throw new NotFoundError(
        'The trade associated with this dispute no longer exists.',
        'TRADE_NOT_FOUND',
      );
    if (trade.status !== TradeStatus.disputed) {
      throw new AppError('INVALID_TRADE_STATUS', 'The trade is not in a disputed state.', 400);
    }

    const refId = id.slice(0, 8);

    if (favor === 'buyer') {
      // Refund buyer's locked NGN back to them
      await walletService.unlock({
        queryRunner: qr,
        userId: trade.buyer_id,
        currency: Currency.NGN,
        amount: trade.total_ngn,
        type: LedgerType.escrow_release,
        initiatedBy: req.user!.id,
        relatedId: trade.id,
        reference: `DIS-REF-${refId}`,
      });

      // Restore sabit available amount
      const sabitRows = (await qr.query(`SELECT * FROM "sabits" WHERE "id" = $1 FOR UPDATE`, [
        trade.sabit_id,
      ])) as Sabit[];
      if (sabitRows.length > 0) {
        const sabit = sabitRows[0];
        const restored = (parseFloat(sabit.available_amount) + parseFloat(trade.amount)).toFixed(2);
        const restoredStatus = sabit.status === 'completed' ? 'active' : sabit.status;
        await qr.query(
          `UPDATE "sabits" SET "available_amount" = $1, "status" = $2 WHERE "id" = $3`,
          [restored, restoredStatus, sabit.id],
        );
      }

      await qr.query(`UPDATE "trades" SET "status" = $1 WHERE "id" = $2`, [
        TradeStatus.cancelled,
        trade.id,
      ]);
    } else {
      // Seller wins: transfer buyer's locked NGN to seller as compensation
      await walletService.transferFromLocked({
        queryRunner: qr,
        fromUserId: trade.buyer_id,
        toUserId: trade.seller_id,
        currency: Currency.NGN,
        amount: trade.total_ngn,
        type: LedgerType.trade_credit,
        initiatedBy: req.user!.id,
        relatedId: trade.id,
        reference: `DIS-SET-${refId}`,
      });

      await qr.query(`UPDATE "trades" SET "status" = $1, "completed_at" = NOW() WHERE "id" = $2`, [
        TradeStatus.completed,
        trade.id,
      ]);
    }

    // Resolve the dispute record
    await qr.query(
      `UPDATE "disputes"
       SET "status" = $1, "resolved_by_id" = $2, "resolution_notes" = $3, "resolved_at" = NOW()
       WHERE "id" = $4`,
      [DisputeStatus.resolved, req.user!.id, notes, id],
    );

    // Notify both parties
    const notificationService = new NotificationService();
    const buyerMsg =
      favor === 'buyer'
        ? `Your dispute for trade ${trade.reference} was resolved in your favour. Your funds have been returned.`
        : `The dispute for trade ${trade.reference} was resolved in the seller's favour.`;
    const sellerMsg =
      favor === 'seller'
        ? `The dispute for trade ${trade.reference} was resolved in your favour.`
        : `The dispute for trade ${trade.reference} was resolved in the buyer's favour.`;

    await notificationService.createNotification({
      queryRunner: qr,
      userId: trade.buyer_id,
      title: 'Dispute Resolved',
      message: buyerMsg,
      type: favor === 'buyer' ? NotificationType.success : NotificationType.info,
      relatedId: id,
    });
    await notificationService.createNotification({
      queryRunner: qr,
      userId: trade.seller_id,
      title: 'Dispute Resolved',
      message: sellerMsg,
      type: favor === 'seller' ? NotificationType.success : NotificationType.info,
      relatedId: id,
    });

    const [buyerRow, sellerRow] = await Promise.all([
      qr.query(`SELECT email, name FROM "users" WHERE "id" = $1`, [trade.buyer_id]),
      qr.query(`SELECT email, name FROM "users" WHERE "id" = $1`, [trade.seller_id]),
    ]);

    if (buyerRow.length > 0) {
      await sendEmail({
        to: buyerRow[0].email,
        subject: `Dispute Resolved — ${trade.reference}`,
        template: 'dispute-resolved',
        context: { name: buyerRow[0].name, reference: trade.reference, outcome: buyerMsg, notes },
      });
    }
    if (sellerRow.length > 0) {
      await sendEmail({
        to: sellerRow[0].email,
        subject: `Dispute Resolved — ${trade.reference}`,
        template: 'dispute-resolved',
        context: { name: sellerRow[0].name, reference: trade.reference, outcome: sellerMsg, notes },
      });
    }

    const [updated] = (await qr.query(`SELECT * FROM "disputes" WHERE "id" = $1`, [
      id,
    ])) as Dispute[];
    return {
      dispute: updated,
      trade_status: favor === 'buyer' ? TradeStatus.cancelled : TradeStatus.completed,
    };
  });

  return ok(res, result);
}

/**
 * @swagger
 * /admin/transactions:
 *   get:
 *     summary: List all ledger transactions across the platform
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listAllTransactions(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const { transactions, total } = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query('SELECT COUNT(*) as total FROM "ledger"')) as [
      { total: string },
    ];
    const transactions = (await qr.query(
      `SELECT l.*, u.name as user_name 
       FROM "ledger" l 
       JOIN "users" u ON l.user_id = u.id 
       ORDER BY l.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limitNum, offset],
    )) as Array<Record<string, unknown>>;
    return { transactions, total: parseInt(total) };
  });
  return ok(res, { items: transactions, total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /admin/deposits/{id}/reject:
 *   post:
 *     summary: Reject a manual foreign deposit
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, example: "Invalid proof of payment" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function rejectDeposit(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);

  const deposit = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1 FOR UPDATE`, [
      id,
    ])) as Deposit[];
    const dep = rows[0];
    if (!dep) throw new NotFoundError('Deposit not found');

    if (dep.status === DepositStatus.completed) {
      throw new AppError('INVALID_STATUS', 'Cannot reject a completed deposit', 400);
    }

    await qr.query(
      `UPDATE "deposits" SET "status" = $1, "rejection_reason" = $2, "reviewed_by" = $3, "reviewed_at" = NOW() WHERE "id" = $4`,
      [DepositStatus.rejected, reason, req.user!.id, id],
    );

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: dep.user_id,
      title: 'Deposit Rejected',
      message: `Your manual deposit of ${dep.amount} ${dep.currency} has been rejected. Reason: ${reason}`,
      type: NotificationType.error,
      relatedId: dep.id,
    });

    const updated = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1`, [
      dep.id,
    ])) as Deposit[];
    return updated[0];
  });

  return ok(res, { deposit });
}

const inviteAdminSchema = z.object({
  email: z.string().email(),
});

/**
 * @swagger
 * /admin/invites:
 *   post:
 *     summary: Create a single-use admin invite (super admin only)
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, example: "newadmin@example.com" }
 *     responses:
 *       200:
 *         description: Invite created
 */
export async function inviteAdmin(req: Request, res: Response) {
  const input = inviteAdminSchema.parse(req.body);
  const inviterId = req.user!.id;
  const invitedEmail = input.email.toLowerCase();

  const result = await withTransaction(async (qr) => {
    const already = (await qr.query(
      `SELECT "id","role","deleted_at","is_suspended" FROM "users" WHERE "email" = $1 LIMIT 1`,
      [invitedEmail],
    )) as Array<{ id: string; role: UserRole; deleted_at: Date | null; is_suspended: boolean }>;

    if (
      already.length > 0 &&
      (already[0].role === UserRole.admin || already[0].role === UserRole.super_admin) &&
      !already[0].deleted_at
    ) {
      return { accepted: true, invitedEmail, inviteId: null as string | null };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const inviteRows = await qr.query(
      `INSERT INTO "admin_invites" ("id","token_hash","inviter_id","invited_email","granted_role","expires_at","consumed_at","consumed_by")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NULL, NULL)
       RETURNING "id"`,
      [token_hash, inviterId, invitedEmail, UserRole.admin, expires_at],
    );

    const inviteId = inviteRows[0]?.id as string;

    await qr.query(
      `INSERT INTO "admin_logs" ("id","admin_id","action","target_type","target_id","details","created_at")
       VALUES (gen_random_uuid(), $1, 'ADMIN_INVITE_CREATED', 'user', $1, $2, now())`,
      [inviterId, JSON.stringify({ invitedEmail, inviteId })],
    );

    return { accepted: false, inviteId, token, invitedEmail };
  });

  if (result.accepted) {
    return ok(res, { message: 'User is already an admin.' });
  }

  const baseUrl = env.API_BASE_URL ?? 'http://localhost:3000';
  const acceptLink = `${baseUrl}/admin/invites/accept?token=${encodeURIComponent(result.token!)}`;

  await sendEmail({
    to: result.invitedEmail,
    subject: 'You are invited to become an admin - Sabo Finance',
    template: 'admin-invite',
    context: { acceptLink, roleLabel: 'admin' },
  });

  return ok(res, { message: 'Admin invite created and email sent.', inviteId: result.inviteId });
}

/**
 * @swagger
 * /admin/invites/accept:
 *   get:
 *     summary: Accept an admin invite token (public)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Invite processed
 */
export async function acceptAdminInvite(req: Request, res: Response) {
  const tokenRaw = req.query.token;
  const token = typeof tokenRaw === 'string' ? tokenRaw : '';
  if (!token) throw new AppError('INVITE_TOKEN_MISSING', 'Invite token is required', 400);

  const token_hash = crypto.createHash('sha256').update(token).digest('hex');

  const result = await withTransaction(async (qr) => {
    const inviteRows = (await qr.query(
      `SELECT * FROM "admin_invites"
       WHERE "token_hash" = $1 AND "consumed_at" IS NULL AND "expires_at" > now()
       LIMIT 1
       FOR UPDATE`,
      [token_hash],
    )) as Array<{
      id: string;
      inviter_id: string;
      invited_email: string;
      granted_role: UserRole | string;
    }>;

    const invite = inviteRows[0];
    if (!invite)
      throw new AppError('INVITE_EXPIRED_OR_INVALID', 'Invite token is invalid or expired', 400);

    const userRows = (await qr.query(
      `SELECT "id","name","email","role","deleted_at" FROM "users" WHERE "email" = $1 AND "deleted_at" IS NULL LIMIT 1 FOR UPDATE`,
      [invite.invited_email],
    )) as Array<{
      id: string;
      name: string;
      email: string;
      role: UserRole;
      deleted_at: Date | null;
    }>;

    const user = userRows[0];
    if (!user) {
      // Invite remains unconsumed until a matching user is available.
      return {
        accepted: false,
        inviteId: invite.id,
        invitedEmail: invite.invited_email,
        grantedRole: invite.granted_role,
      };
    }

    await qr.query(`UPDATE "users" SET "role" = $1 WHERE "id" = $2`, [
      invite.granted_role,
      user.id,
    ]);
    await qr.query(
      `UPDATE "admin_invites" SET "consumed_at" = now(), "consumed_by" = $1 WHERE "id" = $2`,
      [user.id, invite.id],
    );

    await qr.query(
      `INSERT INTO "admin_logs" ("id","admin_id","action","target_type","target_id","details","created_at")
       VALUES (gen_random_uuid(), $1, 'ADMIN_INVITE_ACCEPTED', 'user', $2, $3, now())`,
      [
        invite.inviter_id,
        user.id,
        JSON.stringify({ inviteId: invite.id, acceptedUserId: user.id }),
      ],
    );

    return {
      accepted: true,
      inviteId: invite.id,
      userId: user.id,
      name: user.name,
      email: user.email,
    };
  });

  if (!result.accepted) {
    return ok(res, {
      message: 'Invite is valid. Please set up your account to complete.',
      setupRequired: true,
      invite: {
        email: result.invitedEmail,
        role: result.grantedRole,
      },
    });
  }

  const accepted = result as {
    accepted: true;
    inviteId: string;
    userId: string;
    name: string;
    email: string;
  };

  await sendEmail({
    to: accepted.email,
    subject: 'Admin access granted - Sabo Finance',
    template: 'admin-invite-accepted',
    context: { name: accepted.name },
  });

  return ok(res, { message: 'Invite accepted. Admin role granted.', inviteId: accepted.inviteId });
}

const adminSetupSchema = z.object({
  token: z.string(),
  name: z.string().min(2),
  phone: z.string().min(7).max(32),
  password: z.string().min(8),
});

/**
 * @swagger
 * /admin/invites/setup:
 *   post:
 *     summary: Complete admin account setup using an invite token
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, name, phone, password]
 *             properties:
 *               token: { type: string }
 *               name: { type: string, example: "Jane Doe" }
 *               phone: { type: string, example: "+2348000000000" }
 *               password: { type: string, example: "Password123!" }
 *     responses:
 *       201:
 *         description: Admin account created
 */
export async function completeAdminSetup(req: Request, res: Response) {
  const input = adminSetupSchema.parse(req.body);
  const token_hash = crypto.createHash('sha256').update(input.token).digest('hex');

  const result = await withTransaction(async (qr) => {
    const inviteRows = (await qr.query(
      `SELECT * FROM "admin_invites"
       WHERE "token_hash" = $1 AND "consumed_at" IS NULL AND "expires_at" > now()
       LIMIT 1
       FOR UPDATE`,
      [token_hash],
    )) as Array<{
      id: string;
      inviter_id: string;
      invited_email: string;
      granted_role: UserRole | string;
    }>;

    const invite = inviteRows[0];
    if (!invite)
      throw new AppError('INVITE_EXPIRED_OR_INVALID', 'Invite token is invalid or expired', 400);

    const alreadyExists = (await qr.query(
      `SELECT id FROM "users" WHERE "email" = $1 OR "phone" = $2`,
      [invite.invited_email, input.phone],
    )) as any[];

    if (alreadyExists.length > 0) {
      throw new AppError(
        'USER_ALREADY_EXISTS',
        'A user with this email or phone already exists.',
        400,
      );
    }

    const password_hash = await bcrypt.hash(input.password, 12);
    const username = await generateUsername(input.name, qr);

    const userRows = (await qr.query(
      `INSERT INTO "users" ("id","name","username","email","phone","password_hash","email_verified","phone_verified","kyc_status","role","is_suspended","created_at")
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,true,true,'verified',$6,false, now())
       RETURNING "id","name","email"`,
      [input.name, username, invite.invited_email, input.phone, password_hash, invite.granted_role],
    )) as Array<{ id: string; name: string; email: string }>;

    const user = userRows[0];

    await qr.query(
      `UPDATE "admin_invites" SET "consumed_at" = now(), "consumed_by" = $1 WHERE "id" = $2`,
      [user.id, invite.id],
    );

    await qr.query(
      `INSERT INTO "admin_logs" ("id","admin_id","action","target_type","target_id","details","created_at")
       VALUES (gen_random_uuid(), $1, 'ADMIN_INVITE_ACCEPTED', 'user', $2, $3, now())`,
      [
        invite.inviter_id,
        user.id,
        JSON.stringify({ inviteId: invite.id, acceptedUserId: user.id, setup: true }),
      ],
    );

    return { inviteId: invite.id, userId: user.id, name: user.name, email: user.email };
  });

  await sendEmail({
    to: result.email,
    subject: 'Admin access granted - Sabo Finance',
    template: 'admin-invite-accepted',
    context: { name: result.name },
  });

  return ok(res, { message: 'Admin account created and role granted.', inviteId: result.inviteId });
}

/**
 * @swagger
 * /admin/admins/{id}/remove:
 *   post:
 *     summary: Remove admin role (super admin only)
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Admin removed
 */
export async function removeAdmin(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);

  const result = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","name","email","role","deleted_at" FROM "users" WHERE "id" = $1 AND "deleted_at" IS NULL LIMIT 1 FOR UPDATE`,
      [id],
    )) as Array<{
      id: string;
      name: string;
      email: string;
      role: UserRole;
      deleted_at: Date | null;
    }>;
    const user = rows[0];
    if (!user) throw new NotFoundError('No user with that ID was found.', 'USER_NOT_FOUND');
    if (user.role !== UserRole.admin)
      throw new AppError(
        'NOT_ADMIN',
        'That user is not currently an admin, so their admin role cannot be removed.',
        400,
      );

    await qr.query(`UPDATE "users" SET "role" = $1 WHERE "id" = $2`, [UserRole.user, user.id]);
    await qr.query(
      `INSERT INTO "admin_logs" ("id","admin_id","action","target_type","target_id","details","created_at")
       VALUES (gen_random_uuid(), $1, 'ADMIN_REMOVED', 'user', $2, $3, now())`,
      [req.user!.id, user.id, JSON.stringify({ targetUserId: user.id })],
    );

    return { email: user.email, name: user.name };
  });

  await sendEmail({
    to: result.email,
    subject: 'Admin access removed - Sabo Finance',
    template: 'admin-removed',
    context: { name: result.name },
  });

  return ok(res, { message: 'Admin role removed.' });
}

/**
 * @swagger
 * /admin/admins/{id}/upgrade:
 *   post:
 *     summary: Upgrade admin to super admin (super admin only)
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Admin upgraded
 */
export async function upgradeAdminToSuperAdmin(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);

  const result = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","email","role","deleted_at","name" FROM "users" WHERE "id" = $1 AND "deleted_at" IS NULL LIMIT 1 FOR UPDATE`,
      [id],
    )) as Array<{
      id: string;
      email: string;
      role: UserRole;
      deleted_at: Date | null;
      name: string;
    }>;
    const user = rows[0];
    if (!user) throw new NotFoundError('No user with that ID was found.', 'USER_NOT_FOUND');

    if (user.role !== UserRole.admin)
      throw new AppError(
        'NOT_ADMIN',
        'Only users who are already admins can be upgraded to super admin.',
        400,
      );

    await qr.query(`UPDATE "users" SET "role" = $1 WHERE "id" = $2`, [
      UserRole.super_admin,
      user.id,
    ]);
    await qr.query(
      `INSERT INTO "admin_logs" ("id","admin_id","action","target_type","target_id","details","created_at")
       VALUES (gen_random_uuid(), $1, 'ADMIN_UPGRADED_TO_SUPERADMIN', 'user', $2, $3, now())`,
      [req.user!.id, user.id, JSON.stringify({ targetUserId: user.id })],
    );

    return { email: user.email, name: user.name };
  });

  await sendEmail({
    to: result.email,
    subject: 'Super admin role granted - Sabo Finance',
    template: 'admin-upgraded',
    context: { name: result.name },
  });

  return ok(res, { message: 'Admin upgraded to super admin.' });
}

/**
 * @swagger
 * /admin/admins:
 *   get:
 *     summary: List all administrators (super admin only)
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listAdmins(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const { admins, total } = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query(
      `SELECT COUNT(*) as total FROM "users" WHERE "role" = $1 OR "role" = $2`,
      [UserRole.admin, UserRole.super_admin],
    )) as [{ total: string }];
    const admins = (await qr.query(
      `SELECT "id","name","username","email","phone","role","is_suspended","kyc_status","created_at"
       FROM "users"
       WHERE "role" = $1 OR "role" = $2
       ORDER BY "created_at" DESC
       LIMIT $3 OFFSET $4`,
      [UserRole.admin, UserRole.super_admin, limitNum, offset],
    )) as Array<Record<string, unknown>>;
    return { admins, total: parseInt(total) };
  });
  return ok(res, { items: admins, total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /admin/profile:
 *   get:
 *     summary: Get admin profile
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getAdminProfile(req: Request, res: Response) {
  const adminId = req.user!.id;
  const profile = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","name","email","phone","username","role","profile_picture_url","is_suspended","kyc_status","deleted_at","created_at"
       FROM "users"
       WHERE "id" = $1 LIMIT 1`,
      [adminId],
    )) as Array<Record<string, unknown>>;

    return rows[0];
  });

  return ok(res, { profile });
}

/**
 * @swagger
 * /admin/profile/picture:
 *   post:
 *     summary: Update admin profile picture
 *     tags: [Admin]
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
 */
export async function updateAdminProfilePicture(req: Request, res: Response) {
  const file = req.file as Express.Multer.File | undefined;
  if (!file) throw new AppError('FILE_REQUIRED', 'Profile picture file is required', 400);

  const uploaded = await cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
    {
      folder: 'sabo-finance/admin-profile',
      resource_type: 'image',
    },
  );

  const result = await withTransaction(async (qr) => {
    await qr.query(`UPDATE "users" SET "profile_picture_url" = $1 WHERE "id" = $2`, [
      uploaded.secure_url,
      req.user!.id,
    ]);

    await qr.query(
      `INSERT INTO "admin_logs" ("id","admin_id","action","target_type","target_id","details","created_at")
       VALUES (gen_random_uuid(), $1, 'ADMIN_PROFILE_PICTURE_UPDATED', 'user', $1, $2, now())`,
      [req.user!.id, JSON.stringify({ hasPicture: true })],
    );

    return { profile_picture_url: uploaded.secure_url };
  });

  return ok(res, { ...result });
}

/**
 * @swagger
 * /admin/logs:
 *   get:
 *     summary: List admin logs (admin sees own logs, super admin sees all)
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listAdminLogs(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;
  const actorId = req.user!.id;
  const isSuper = req.user!.role === UserRole.super_admin;

  const { logs, total } = await withTransaction(async (qr) => {
    const params: unknown[] = [];
    let baseQuery = `FROM "admin_logs"`;
    if (!isSuper) {
      baseQuery += ` WHERE "admin_id" = $1`;
      params.push(actorId);
    }

    const [{ total }] = (await qr.query(`SELECT COUNT(*) as total ${baseQuery}`, params)) as [
      { total: string },
    ];

    let dataQuery = `SELECT * ${baseQuery} ORDER BY "created_at" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const dataParams = [...params, limitNum, offset];
    const logs = (await qr.query(dataQuery, dataParams)) as Array<Record<string, unknown>>;

    return { logs, total: parseInt(total) };
  });

  return ok(res, { items: logs, total, page: pageNum, limit: limitNum });
}

const metricsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  launch_date: z.string().datetime({ offset: true }).optional(),
  granularity: z.enum(['day', 'week', 'month']).default('month'),
});

/**
 * @swagger
 * /admin/analytics/metrics:
 *   get:
 *     summary: Comprehensive platform metrics for reporting and investor dashboards
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Start of window for time-bounded metrics (ISO 8601). Defaults to platform inception.
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: End of window for time-bounded metrics (ISO 8601). Defaults to now.
 *       - in: query
 *         name: launch_date
 *         schema: { type: string, format: date-time }
 *         description: Reference date for "users at launch" metric (ISO 8601). Defaults to 2023-10-01.
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getMetricsAnalytics(req: Request, res: Response) {
  const query = metricsQuerySchema.parse(req.query);
  const granularity = query.granularity;
  const windowTo = query.to ?? new Date().toISOString();
  const windowFrom = query.from ?? '1970-01-01T00:00:00.000Z';
  const launchDate = query.launch_date ?? '2023-10-01T00:00:00.000Z';

  // Growth chart default windows are anchored to clean boundaries so bucket
  // counts are always exactly 7 (day), 4 (week), or 12 (month).
  function anchoredGrowthFrom(): string {
    const now = new Date();
    if (granularity === 'day') {
      // Start of day 6 days ago → today = 7 buckets
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    if (granularity === 'week') {
      // Monday of the current week, minus 3 weeks → 4 complete ISO-week buckets
      const daysToMonday = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const monday = new Date(now);
      monday.setDate(monday.getDate() - daysToMonday - 21); // 3 prior weeks
      monday.setHours(0, 0, 0, 0);
      return monday.toISOString();
    }
    // month: first day of the month 11 months ago → 12 buckets
    const d = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return d.toISOString();
  }

  const growthFrom = query.from ?? anchoredGrowthFrom();

  const metrics = await withTransaction(async (qr) => {
    // ─────────────────────────────────────────────────────────────────
    // USER METRICS
    // total_registered/active/suspended/kyc = all-time platform snapshot
    // new_registrations = users who registered within the window
    // ─────────────────────────────────────────────────────────────────

    const [userCounts] = (await qr.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL)                                                          AS total_registered,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_suspended = false AND kyc_status = 'verified')      AS total_active,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_suspended = true)                                  AS total_suspended,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND kyc_status = 'verified')                              AS kyc_verified,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND kyc_status = 'pending')                               AS kyc_pending,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND kyc_status = 'rejected')                              AS kyc_rejected,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND kyc_status = 'unverified')                            AS kyc_unverified,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at <= $1::timestamptz)                        AS users_at_launch
      FROM "users"
      WHERE "role" = 'user'
    `,
      [launchDate],
    )) as [Record<string, string>];

    const totalRegistered = parseInt(userCounts.total_registered) || 0;
    const kycVerified = parseInt(userCounts.kyc_verified) || 0;
    const kycVerifiedPct =
      totalRegistered > 0 ? parseFloat(((kycVerified / totalRegistered) * 100).toFixed(2)) : 0;

    // MAU: distinct users with a completed ledger entry in the last 30 days (rolling, not window-scoped)
    const [mauRow] = (await qr.query(`
      SELECT COUNT(DISTINCT user_id) AS mau
      FROM "ledger"
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND status = 'completed'
    `)) as [Record<string, string>];

    // ─────────────────────────────────────────────────────────────────
    // KYC METRICS — all-time totals (not window-scoped)
    // ─────────────────────────────────────────────────────────────────

    const [kycTimingRow] = (await qr.query(`
      SELECT
        ROUND(
          AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at)) / 3600)::numeric,
          2
        ) AS avg_verification_hours,
        ROUND(
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (reviewed_at - created_at)) / 3600)::numeric,
          2
        ) AS median_verification_hours
      FROM "kyc"
      WHERE status = 'verified'
        AND reviewed_at IS NOT NULL
    `)) as [Record<string, string | null>];

    // Drop-off: all-time users who never submitted KYC
    const [kycDropoffRow] = (await qr.query(`
      SELECT
        COUNT(u.id)                                          AS total_users,
        COUNT(u.id) FILTER (WHERE k.user_id IS NULL)         AS never_submitted,
        ROUND(
          (COUNT(u.id) FILTER (WHERE k.user_id IS NULL)::numeric
            / NULLIF(COUNT(u.id), 0)::numeric) * 100,
          2
        )                                                    AS dropoff_rate_pct
      FROM "users" u
      LEFT JOIN (
        SELECT DISTINCT user_id FROM "kyc"
      ) k ON k.user_id = u.id
      WHERE u.role = 'user'
        AND u.deleted_at IS NULL
    `)) as [Record<string, string>];

    // First-attempt success rate — all-time
    const [kycFirstAttemptRow] = (await qr.query(`
      WITH first_submissions AS (
        SELECT DISTINCT ON (user_id)
          user_id,
          status
        FROM "kyc"
        ORDER BY user_id, created_at ASC
      )
      SELECT
        COUNT(*) AS total_submitted,
        COUNT(*) FILTER (WHERE status = 'verified')  AS first_attempt_verified,
        COUNT(*) FILTER (WHERE status = 'rejected')  AS first_attempt_rejected,
        COUNT(*) FILTER (WHERE status = 'pending')   AS first_attempt_pending,
        ROUND(
          (COUNT(*) FILTER (WHERE status = 'verified')::numeric
            / NULLIF(COUNT(*), 0)::numeric) * 100,
          2
        ) AS first_attempt_success_rate_pct
      FROM first_submissions
    `)) as [Record<string, string>];

    // Total KYC submissions — all-time
    const [kycTotalsRow] = (await qr.query(`
      SELECT
        COUNT(*)                                            AS total_submissions,
        COUNT(*) FILTER (WHERE status = 'verified')        AS verified,
        COUNT(*) FILTER (WHERE status = 'rejected')        AS rejected,
        COUNT(*) FILTER (WHERE status = 'pending')         AS pending
      FROM "kyc"
    `)) as [Record<string, string>];

    // ─────────────────────────────────────────────────────────────────
    // TRADE / VOLUME METRICS — all-time totals (not window-scoped)
    // ─────────────────────────────────────────────────────────────────

    const tradeVolumeRows = (await qr.query(`
      SELECT
        currency,
        COUNT(*)                                                                  AS total_trades,
        COUNT(*) FILTER (WHERE status = 'completed')                             AS completed_trades,
        COUNT(*) FILTER (WHERE status = 'cancelled')                             AS cancelled_trades,
        COUNT(*) FILTER (WHERE status = 'disputed')                              AS disputed_trades,
        SUM(total_ngn) FILTER (WHERE status = 'completed')                       AS lifetime_ngn_volume,
        SUM(amount)    FILTER (WHERE status = 'completed')                       AS lifetime_foreign_volume,
        AVG(total_ngn) FILTER (WHERE status = 'completed')                       AS avg_trade_size_ngn,
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)
          FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL)       AS avg_settlement_hours
      FROM "trades"
      GROUP BY currency
    `)) as Array<Record<string, string | null>>;

    const [tradeTotalsRow] = (await qr.query(`
      SELECT
        COUNT(*)                                                            AS total_initiated,
        COUNT(*) FILTER (WHERE status = 'completed')                       AS total_completed,
        COUNT(*) FILTER (WHERE status = 'cancelled')                       AS total_cancelled,
        COUNT(*) FILTER (WHERE status = 'disputed')                        AS total_disputed,
        COALESCE(SUM(total_ngn) FILTER (WHERE status = 'completed'), 0)    AS lifetime_ngn_volume,
        ROUND(AVG(total_ngn) FILTER (WHERE status = 'completed')::numeric, 2) AS avg_trade_size_ngn,
        ROUND(
          (COUNT(*) FILTER (WHERE status = 'completed')::numeric
            / NULLIF(COUNT(*), 0)::numeric) * 100,
          2
        )                                                                  AS success_rate_pct,
        ROUND(
          (COUNT(*) FILTER (WHERE status = 'cancelled')::numeric
            / NULLIF(COUNT(*), 0)::numeric) * 100,
          2
        )                                                                  AS cancellation_rate_pct,
        ROUND(
          AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)
            FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL)::numeric,
          2
        )                                                                  AS avg_settlement_hours
      FROM "trades"
    `)) as [Record<string, string | null>];

    // ─────────────────────────────────────────────────────────────────
    // P2P / SABITS METRICS — all-time totals (not window-scoped)
    // ─────────────────────────────────────────────────────────────────

    const [p2pRow] = (await qr.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')     AS active_listings,
        COUNT(*) FILTER (WHERE status = 'completed')  AS completed_listings,
        COUNT(*) FILTER (WHERE status = 'cancelled')  AS cancelled_listings,
        COUNT(DISTINCT user_id)                       AS total_sellers
      FROM "sabits"
    `)) as [Record<string, string>];

    const [p2pBuyersRow] = (await qr.query(`
      SELECT COUNT(DISTINCT buyer_id) AS total_buyers
      FROM "trades"
    `)) as [Record<string, string>];

    const [repeatRow] = (await qr.query(`
      WITH trade_counts AS (
        SELECT buyer_id AS user_id, COUNT(*) AS cnt
        FROM "trades"
        WHERE status = 'completed'
        GROUP BY buyer_id
        UNION ALL
        SELECT seller_id AS user_id, COUNT(*) AS cnt
        FROM "trades"
        WHERE status = 'completed'
        GROUP BY seller_id
      ),
      user_trade_totals AS (
        SELECT user_id, SUM(cnt) AS total_trades
        FROM trade_counts
        GROUP BY user_id
      )
      SELECT
        COUNT(*)                                     AS users_who_traded,
        COUNT(*) FILTER (WHERE total_trades > 1)     AS repeat_traders,
        ROUND(
          (COUNT(*) FILTER (WHERE total_trades > 1)::numeric
            / NULLIF(COUNT(*), 0)::numeric) * 100,
          2
        )                                            AS repeat_rate_pct
      FROM user_trade_totals
    `)) as [Record<string, string>];

    const [disputeRow] = (await qr.query(`
      SELECT
        COUNT(*)                                         AS total_disputes,
        COUNT(*) FILTER (WHERE status = 'open')          AS open_disputes,
        COUNT(*) FILTER (WHERE status = 'resolved')      AS resolved_disputes
      FROM "disputes"
    `)) as [Record<string, string>];

    const totalCompletedTrades = parseInt(tradeTotalsRow.total_completed ?? '0') || 0;
    const totalDisputes = parseInt(disputeRow.total_disputes) || 0;
    const disputeRatePct =
      totalCompletedTrades > 0
        ? parseFloat(((totalDisputes / totalCompletedTrades) * 100).toFixed(4))
        : 0;

    // ─────────────────────────────────────────────────────────────────
    // ESCROW METRICS — all-time totals; live_tvl is current wallet snapshot
    // ─────────────────────────────────────────────────────────────────

    const [escrowRow] = (await qr.query(`
      SELECT
        -- All-time NGN that passed through escrow lock (completed + escrowed + disputed)
        COALESCE(
          SUM(total_ngn) FILTER (WHERE status IN ('completed', 'escrowed', 'disputed')),
          0
        ) AS lifetime_volume_ngn,
        -- NGN value of trades currently locked in escrow right now
        COALESCE(
          SUM(total_ngn) FILTER (WHERE status = 'escrowed'),
          0
        ) AS current_volume_ngn,
        ROUND(
          (COUNT(*) FILTER (WHERE status = 'completed')::numeric
            / NULLIF(
                COUNT(*) FILTER (WHERE status IN ('completed','cancelled')),
                0
              )::numeric) * 100,
          2
        ) AS completion_rate_pct,
        ROUND(
          (COUNT(*) FILTER (WHERE status = 'cancelled')::numeric
            / NULLIF(COUNT(*), 0)::numeric) * 100,
          2
        ) AS timeout_rate_pct
      FROM "trades"
    `)) as [Record<string, string | null>];

    // currently_escrowed is a live snapshot — never window-scoped
    const [escrowLiveRow] = (await qr.query(`
      SELECT COUNT(*) AS currently_escrowed FROM "trades" WHERE status = 'escrowed'
    `)) as [Record<string, string>];

    // Live TVL is always a current wallet snapshot — not window-scoped
    const escrowTvlRows = (await qr.query(`
      SELECT currency, COALESCE(SUM(escrow_balance), 0) AS locked_value
      FROM "wallets"
      WHERE escrow_balance > 0
      GROUP BY currency
    `)) as Array<Record<string, string>>;

    // ─────────────────────────────────────────────────────────────────
    // DEPOSIT METRICS — all-time totals (not window-scoped)
    // ─────────────────────────────────────────────────────────────────

    const depositVolumeRows = (await qr.query(`
      SELECT
        currency,
        COUNT(*)                                              AS total_deposits,
        COUNT(*) FILTER (WHERE status = 'completed')         AS completed_deposits,
        COUNT(*) FILTER (WHERE status = 'rejected')          AS rejected_deposits,
        COUNT(*) FILTER (WHERE status = 'pending_review')    AS pending_deposits,
        COUNT(*) FILTER (WHERE status = 'initiated')         AS initiated_deposits,
        COUNT(*) FILTER (WHERE status = 'failed')            AS failed_deposits,
        COUNT(*) FILTER (WHERE status = 'expired')           AS expired_deposits,
        COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) AS total_volume
      FROM "deposits"
      GROUP BY currency
    `)) as Array<Record<string, string>>;

    // ─────────────────────────────────────────────────────────────────
    // GROWTH METRICS — monthly breakdown within the window
    // ─────────────────────────────────────────────────────────────────

    // All three granularities include a baseline CTE that counts users registered
    // BEFORE the window start, so cumulative_users starts from that offset rather
    // than 0. This ensures the chart adds up to total_registered correctly.
    const userGrowthSql =
      granularity === 'day'
        ? `WITH baseline AS (
           SELECT COUNT(*) AS prior_users FROM "users"
           WHERE role = 'user' AND deleted_at IS NULL
             AND created_at < DATE_TRUNC('day', $1::timestamptz)
         )
         SELECT
           TO_CHAR(d.day, 'Dy') AS label,
           COALESCE(u.new_users, 0) AS new_users,
           b.prior_users + SUM(COALESCE(u.new_users, 0)) OVER (ORDER BY d.day) AS cumulative_users
         FROM generate_series(
           DATE_TRUNC('day', $1::timestamptz),
           DATE_TRUNC('day', $2::timestamptz),
           INTERVAL '1 day'
         ) AS d(day)
         CROSS JOIN baseline b
         LEFT JOIN (
           SELECT DATE_TRUNC('day', created_at) AS bucket, COUNT(*) AS new_users
           FROM "users"
           WHERE role = 'user' AND deleted_at IS NULL
             AND created_at BETWEEN $1::timestamptz AND $2::timestamptz
           GROUP BY bucket
         ) u ON u.bucket = d.day
         ORDER BY d.day ASC`
        : granularity === 'week'
          ? `WITH baseline AS (
           SELECT COUNT(*) AS prior_users FROM "users"
           WHERE role = 'user' AND deleted_at IS NULL
             AND created_at < DATE_TRUNC('week', $1::timestamptz)
         ),
         weeks AS (
           SELECT generate_series(
             DATE_TRUNC('week', $1::timestamptz),
             DATE_TRUNC('week', $2::timestamptz),
             INTERVAL '1 week'
           ) AS bucket
         )
         SELECT
           'Week ' || ROW_NUMBER() OVER (ORDER BY w.bucket) AS label,
           COALESCE(u.new_users, 0) AS new_users,
           b.prior_users + SUM(COALESCE(u.new_users, 0)) OVER (ORDER BY w.bucket) AS cumulative_users
         FROM weeks w
         CROSS JOIN baseline b
         LEFT JOIN (
           SELECT DATE_TRUNC('week', created_at) AS bucket, COUNT(*) AS new_users
           FROM "users"
           WHERE role = 'user' AND deleted_at IS NULL
             AND created_at BETWEEN $1::timestamptz AND $2::timestamptz
           GROUP BY bucket
         ) u ON u.bucket = w.bucket
         ORDER BY w.bucket ASC`
          : `WITH baseline AS (
           SELECT COUNT(*) AS prior_users FROM "users"
           WHERE role = 'user' AND deleted_at IS NULL
             AND created_at < DATE_TRUNC('month', $1::timestamptz)
         ),
         months AS (
           SELECT generate_series(
             DATE_TRUNC('month', $1::timestamptz),
             DATE_TRUNC('month', $2::timestamptz),
             INTERVAL '1 month'
           ) AS bucket
         )
         SELECT
           TO_CHAR(m.bucket, 'Mon YY') AS label,
           COALESCE(u.new_users, 0) AS new_users,
           b.prior_users + SUM(COALESCE(u.new_users, 0)) OVER (ORDER BY m.bucket) AS cumulative_users
         FROM months m
         CROSS JOIN baseline b
         LEFT JOIN (
           SELECT DATE_TRUNC('month', created_at) AS bucket, COUNT(*) AS new_users
           FROM "users"
           WHERE role = 'user' AND deleted_at IS NULL
             AND created_at BETWEEN $1::timestamptz AND $2::timestamptz
           GROUP BY bucket
         ) u ON u.bucket = m.bucket
         ORDER BY m.bucket ASC`;

    const userGrowthMonthly = (await qr.query(userGrowthSql, [growthFrom, windowTo])) as Array<
      Record<string, string>
    >;

    const tradeVolumeSql =
      granularity === 'day'
        ? `WITH baseline AS (
           SELECT COALESCE(SUM(total_ngn), 0) AS prior_volume
           FROM "trades"
           WHERE status = 'completed'
             AND created_at < DATE_TRUNC('day', $1::timestamptz)
         ),
         days AS (
           SELECT generate_series(
             DATE_TRUNC('day', $1::timestamptz),
             DATE_TRUNC('day', $2::timestamptz),
             INTERVAL '1 day'
           ) AS bucket
         )
         SELECT
           TO_CHAR(d.bucket, 'Dy') AS label,
           COALESCE(t.completed_trades, 0) AS completed_trades,
           COALESCE(t.ngn_volume, '0') AS ngn_volume,
           (b.prior_volume + SUM(COALESCE(t.ngn_volume::numeric, 0)) OVER (ORDER BY d.bucket))::text AS cumulative_ngn_volume
         FROM days d
         CROSS JOIN baseline b
         LEFT JOIN (
           SELECT
             DATE_TRUNC('day', created_at) AS bucket,
             COUNT(*) FILTER (WHERE status = 'completed') AS completed_trades,
             COALESCE(SUM(total_ngn) FILTER (WHERE status = 'completed'), 0) AS ngn_volume
           FROM "trades"
           WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
           GROUP BY bucket
         ) t ON t.bucket = d.bucket
         ORDER BY d.bucket ASC`
        : granularity === 'week'
          ? `WITH baseline AS (
           SELECT COALESCE(SUM(total_ngn), 0) AS prior_volume
           FROM "trades"
           WHERE status = 'completed'
             AND created_at < DATE_TRUNC('week', $1::timestamptz)
         ),
         weeks AS (
           SELECT generate_series(
             DATE_TRUNC('week', $1::timestamptz),
             DATE_TRUNC('week', $2::timestamptz),
             INTERVAL '1 week'
           ) AS bucket
         )
         SELECT
           'Week ' || ROW_NUMBER() OVER (ORDER BY w.bucket) AS label,
           COALESCE(t.completed_trades, 0) AS completed_trades,
           COALESCE(t.ngn_volume, '0') AS ngn_volume,
           (b.prior_volume + SUM(COALESCE(t.ngn_volume::numeric, 0)) OVER (ORDER BY w.bucket))::text AS cumulative_ngn_volume
         FROM weeks w
         CROSS JOIN baseline b
         LEFT JOIN (
           SELECT
             DATE_TRUNC('week', created_at) AS bucket,
             COUNT(*) FILTER (WHERE status = 'completed') AS completed_trades,
             COALESCE(SUM(total_ngn) FILTER (WHERE status = 'completed'), 0) AS ngn_volume
           FROM "trades"
           WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
           GROUP BY bucket
         ) t ON t.bucket = w.bucket
         ORDER BY w.bucket ASC`
          : `WITH baseline AS (
           SELECT COALESCE(SUM(total_ngn), 0) AS prior_volume
           FROM "trades"
           WHERE status = 'completed'
             AND created_at < DATE_TRUNC('month', $1::timestamptz)
         ),
         months AS (
           SELECT generate_series(
             DATE_TRUNC('month', $1::timestamptz),
             DATE_TRUNC('month', $2::timestamptz),
             INTERVAL '1 month'
           ) AS bucket
         )
         SELECT
           TO_CHAR(m.bucket, 'Mon YY') AS label,
           COALESCE(t.completed_trades, 0) AS completed_trades,
           COALESCE(t.ngn_volume, '0') AS ngn_volume,
           (b.prior_volume + SUM(COALESCE(t.ngn_volume::numeric, 0)) OVER (ORDER BY m.bucket))::text AS cumulative_ngn_volume
         FROM months m
         CROSS JOIN baseline b
         LEFT JOIN (
           SELECT
             DATE_TRUNC('month', created_at) AS bucket,
             COUNT(*) FILTER (WHERE status = 'completed') AS completed_trades,
             COALESCE(SUM(total_ngn) FILTER (WHERE status = 'completed'), 0) AS ngn_volume
           FROM "trades"
           WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
           GROUP BY bucket
         ) t ON t.bucket = m.bucket
         ORDER BY m.bucket ASC`;

    const tradeVolumeMonthly = (await qr.query(tradeVolumeSql, [growthFrom, windowTo])) as Array<
      Record<string, string>
    >;

    // ─────────────────────────────────────────────────────────────────
    // PLATFORM / STATIC CONSTANTS
    // ─────────────────────────────────────────────────────────────────

    const platformConstants = {
      pin_confirmation_window_minutes: 30,
      bid_expiry_hours: 24,
      background_jobs_count: 4,
      supported_currencies: ['NGN', 'GBP', 'USD', 'CAD'],
      kyc_process: 'manual_admin_review',
      deposit_ngn_provider: 'flutterwave',
      deposit_foreign_process: 'manual_proof_upload',
    };

    return {
      generated_at: new Date().toISOString(),
      window: { from: windowFrom, to: windowTo },
      granularity,
      launch_date: launchDate,

      users: {
        // All-time platform snapshot
        total_registered: totalRegistered,
        total_active: parseInt(userCounts.total_active) || 0,
        total_suspended: parseInt(userCounts.total_suspended) || 0,
        users_at_launch: parseInt(userCounts.users_at_launch) || 0,
        // Rolling 30-day
        monthly_active_users: parseInt(mauRow.mau) || 0,
        // KYC status breakdown is current state of all users (snapshot)
        kyc: {
          verified: kycVerified,
          verified_pct: kycVerifiedPct,
          pending: parseInt(userCounts.kyc_pending) || 0,
          rejected: parseInt(userCounts.kyc_rejected) || 0,
          unverified: parseInt(userCounts.kyc_unverified) || 0,
        },
      },

      kyc: {
        total_submissions: parseInt(kycTotalsRow.total_submissions) || 0,
        verified_submissions: parseInt(kycTotalsRow.verified) || 0,
        rejected_submissions: parseInt(kycTotalsRow.rejected) || 0,
        pending_submissions: parseInt(kycTotalsRow.pending) || 0,
        avg_verification_hours: kycTimingRow.avg_verification_hours
          ? parseFloat(kycTimingRow.avg_verification_hours)
          : null,
        median_verification_hours: kycTimingRow.median_verification_hours
          ? parseFloat(kycTimingRow.median_verification_hours)
          : null,
        avg_verification_hours_note:
          kycTimingRow.avg_verification_hours === null
            ? 'No verified KYC records with reviewed_at timestamp yet.'
            : null,
        dropoff: {
          total_users: parseInt(kycDropoffRow.total_users) || 0,
          never_submitted: parseInt(kycDropoffRow.never_submitted) || 0,
          dropoff_rate_pct: parseFloat(kycDropoffRow.dropoff_rate_pct) || 0,
        },
        first_attempt: {
          total_submitted: parseInt(kycFirstAttemptRow.total_submitted) || 0,
          first_attempt_verified: parseInt(kycFirstAttemptRow.first_attempt_verified) || 0,
          first_attempt_rejected: parseInt(kycFirstAttemptRow.first_attempt_rejected) || 0,
          first_attempt_pending: parseInt(kycFirstAttemptRow.first_attempt_pending) || 0,
          success_rate_pct: parseFloat(kycFirstAttemptRow.first_attempt_success_rate_pct) || 0,
        },
      },

      trades: {
        total_initiated: parseInt(tradeTotalsRow.total_initiated ?? '0') || 0,
        total_completed: totalCompletedTrades,
        total_cancelled: parseInt(tradeTotalsRow.total_cancelled ?? '0') || 0,
        total_disputed: parseInt(tradeTotalsRow.total_disputed ?? '0') || 0,
        success_rate_pct: parseFloat(tradeTotalsRow.success_rate_pct ?? '0') || 0,
        cancellation_rate_pct: parseFloat(tradeTotalsRow.cancellation_rate_pct ?? '0') || 0,
        lifetime_ngn_volume: tradeTotalsRow.lifetime_ngn_volume ?? '0',
        avg_trade_size_ngn: tradeTotalsRow.avg_trade_size_ngn ?? '0',
        avg_settlement_hours: tradeTotalsRow.avg_settlement_hours
          ? parseFloat(tradeTotalsRow.avg_settlement_hours)
          : null,
        by_currency: tradeVolumeRows.map((r) => ({
          currency: r.currency,
          total_trades: parseInt(r.total_trades ?? '0') || 0,
          completed_trades: parseInt(r.completed_trades ?? '0') || 0,
          cancelled_trades: parseInt(r.cancelled_trades ?? '0') || 0,
          disputed_trades: parseInt(r.disputed_trades ?? '0') || 0,
          lifetime_ngn_volume: r.lifetime_ngn_volume ?? '0',
          lifetime_foreign_volume: r.lifetime_foreign_volume ?? '0',
          avg_trade_size_ngn: r.avg_trade_size_ngn
            ? parseFloat(r.avg_trade_size_ngn).toFixed(2)
            : '0',
          avg_settlement_hours: r.avg_settlement_hours
            ? parseFloat(r.avg_settlement_hours).toFixed(2)
            : null,
        })),
      },

      p2p: {
        active_listings: parseInt(p2pRow.active_listings) || 0,
        completed_listings: parseInt(p2pRow.completed_listings) || 0,
        cancelled_listings: parseInt(p2pRow.cancelled_listings) || 0,
        total_sellers: parseInt(p2pRow.total_sellers) || 0,
        total_buyers: parseInt(p2pBuyersRow.total_buyers) || 0,
        repeat_traders: parseInt(repeatRow.repeat_traders) || 0,
        users_who_traded: parseInt(repeatRow.users_who_traded) || 0,
        repeat_rate_pct: parseFloat(repeatRow.repeat_rate_pct) || 0,
        dispute_rate_pct: disputeRatePct,
        disputes: {
          total: totalDisputes,
          open: parseInt(disputeRow.open_disputes) || 0,
          resolved: parseInt(disputeRow.resolved_disputes) || 0,
        },
      },

      escrow: {
        lifetime_volume_ngn: escrowRow.lifetime_volume_ngn ?? '0',
        current_volume_ngn: escrowRow.current_volume_ngn ?? '0',
        completion_rate_pct: parseFloat(escrowRow.completion_rate_pct ?? '0') || 0,
        timeout_rate_pct: parseFloat(escrowRow.timeout_rate_pct ?? '0') || 0,
        currently_escrowed_trades: parseInt(escrowLiveRow.currently_escrowed) || 0,
        live_tvl_by_currency: escrowTvlRows.map((r) => ({
          currency: r.currency,
          locked_value: r.locked_value,
        })),
      },

      deposits: {
        by_currency: depositVolumeRows.map((r) => ({
          currency: r.currency,
          total_deposits: parseInt(r.total_deposits) || 0,
          completed_deposits: parseInt(r.completed_deposits) || 0,
          rejected_deposits: parseInt(r.rejected_deposits) || 0,
          pending_deposits: parseInt(r.pending_deposits) || 0,
          initiated_deposits: parseInt(r.initiated_deposits) || 0,
          failed_deposits: parseInt(r.failed_deposits) || 0,
          expired_deposits: parseInt(r.expired_deposits) || 0,
          // total_volume = SUM of completed deposits only
          total_volume: r.total_volume,
        })),
      },

      growth: {
        user_growth_monthly: userGrowthMonthly.map((r) => ({
          label: r.label,
          new_users: parseInt(r.new_users) || 0,
          cumulative_users: parseInt(r.cumulative_users) || 0,
        })),
        trade_volume_monthly: tradeVolumeMonthly.map((r) => ({
          label: r.label,
          completed_trades: parseInt(r.completed_trades) || 0,
          ngn_volume: r.ngn_volume,
          cumulative_ngn_volume: r.cumulative_ngn_volume,
        })),
      },

      platform: platformConstants,
    };
  });

  return ok(res, metrics);
}
