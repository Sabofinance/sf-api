import crypto from 'crypto';

import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../../config/env';
import { Deposit } from '../../database/entities/Deposit';
import { Kyc } from '../../database/entities/Kyc';
import { User } from '../../database/entities/User';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { NotificationService } from '../../services/notificationService';
import { WalletService } from '../../services/walletService';
import { ok } from '../../utils/apiResponse';
import { Currency, DepositStatus, KycStatus, LedgerType, NotificationType, UserRole } from '../../utils/enums';
import { AppError, NotFoundError, UnauthorizedError } from '../../utils/errors';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

function signAdminAccessToken(user: { id: string; name: string; email: string; role: UserRole; kyc_status: string }) {
  const payload = { id: user.id, name: user.name, email: user.email, role: user.role, kyc_status: user.kyc_status };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '8h' });
}

function signAdminRefreshToken(user: { id: string; name: string; email: string; role: UserRole; kyc_status: string }) {
  const payload = { id: user.id, name: user.name, email: user.email, role: user.role, kyc_status: user.kyc_status };
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
      `SELECT "id","password_hash","role","email","name","kyc_status" FROM "users" WHERE "email" = $1 AND ("role" = $2 OR "role" = $3) LIMIT 1`,
      [input.email.toLowerCase(), UserRole.admin, UserRole.super_admin],
    )) as Array<{ id: string; password_hash: string; role: UserRole; email: string; name: string; kyc_status: string; }>;
    return rows[0];
  });

  if (!user) throw new UnauthorizedError('Invalid admin credentials');

  const okPass = await bcrypt.compare(input.password, user.password_hash);
  if (!okPass) throw new UnauthorizedError('Invalid admin credentials');

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
      'SELECT "id", "name", "email", "role", "kyc_status" FROM "users" WHERE "email" = $1 AND ("role" = $2 OR "role" = $3) AND "otp" = $4 AND "otp_expires" > NOW() LIMIT 1',
      [input.email.toLowerCase(), UserRole.admin, UserRole.super_admin, input.otp],
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

  const accessToken = signAdminAccessToken(user);
  const refreshToken = signAdminRefreshToken(user);

  return ok(res, { 
    tokens: { accessToken, refreshToken },
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
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
  const users = await withTransaction(async (qr) => {
    return (await qr.query(`SELECT * FROM "users" ORDER BY "created_at" DESC LIMIT $1 OFFSET $2`, [
      limit,
      (parseInt(page) - 1) * parseInt(limit),
    ])) as User[];
  });
  return ok(res, { users });
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
    if (userRows.length === 0) throw new NotFoundError('User not found');
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
  const submissions = await withTransaction(async (qr) => {
    return (await qr.query(`SELECT * FROM "kyc" ORDER BY "created_at" DESC LIMIT $1 OFFSET $2`, [
      limit,
      (parseInt(page) - 1) * parseInt(limit),
    ])) as Kyc[];
  });
  return ok(res, { submissions });
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
    const kycRows = (await qr.query(`SELECT * FROM "kyc" WHERE "id" = $1 FOR UPDATE`, [id])) as Kyc[];
    const kyc = kycRows[0];
    if (!kyc) throw new NotFoundError('KYC submission not found');

    await qr.query(`UPDATE "kyc" SET "status" = $1, "reviewed_by" = $2 WHERE "id" = $3`, [
      KycStatus.verified,
      req.user!.id,
      id,
    ]);
    await qr.query(`UPDATE "users" SET "kyc_status" = $1 WHERE "id" = $2`, [KycStatus.verified, kyc.user_id]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: kyc.user_id,
      title: 'KYC Approved',
      message: 'Your KYC documents have been approved. You now have full access to the platform.',
      type: NotificationType.success,
      relatedId: id,
    });

    const user = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [kyc.user_id])) as User[];
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
    const kycRows = (await qr.query(`SELECT * FROM "kyc" WHERE "id" = $1 FOR UPDATE`, [id])) as Kyc[];
    const kyc = kycRows[0];
    if (!kyc) throw new NotFoundError('KYC submission not found');

    await qr.query(`UPDATE "kyc" SET "status" = $1, "rejection_reason" = $2, "reviewed_by" = $3 WHERE "id" = $4`, [
      KycStatus.rejected,
      reason,
      req.user!.id,
      id,
    ]);
    await qr.query(`UPDATE "users" SET "kyc_status" = $1 WHERE "id" = $2`, [KycStatus.rejected, kyc.user_id]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: kyc.user_id,
      title: 'KYC Rejected',
      message: `Your KYC submission was rejected: ${reason}`,
      type: NotificationType.error,
      relatedId: id,
    });

    const user = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [kyc.user_id])) as User[];
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
    const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1 FOR UPDATE`, [id])) as Deposit[];
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

    await qr.query(`UPDATE "deposits" SET "status" = $1, "reviewed_by" = $2 WHERE "id" = $3`, [
      DepositStatus.completed,
      req.user!.id,
      dep.id,
    ]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: dep.user_id,
      title: 'Deposit Confirmed',
      message: `Your deposit of ${dep.amount} ${dep.currency} has been approved and credited.`,
      type: NotificationType.success,
      relatedId: dep.id,
    });

    const updated = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1`, [dep.id])) as Deposit[];

    const user = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [dep.user_id])) as User[];
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
    const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1 FOR UPDATE`, [id])) as Deposit[];
    const dep = rows[0];
    if (!dep) throw new NotFoundError('Deposit not found');

    if (dep.status === DepositStatus.completed) return dep;
    
    if (dep.status !== DepositStatus.initiated) {
      throw new AppError('INVALID_STATUS', 'Only initiated deposits can be verified with Flutterwave', 400);
    }
    
    if (dep.currency !== Currency.NGN) {
      throw new AppError('INVALID_CURRENCY', 'Only NGN deposits can be verified with Flutterwave', 400);
    }

    // Verify via Flutterwave Verification API
    if (env.FLUTTERWAVE_SECRET) {
      try {
        // Flutterwave has an endpoint to verify transactions by tx_ref
        const response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${dep.reference}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${env.FLUTTERWAVE_SECRET}`,
            'Content-Type': 'application/json',
          },
        });
        
        const result = await response.json();
        
        if (!response.ok || result.status !== 'success') {
          throw new AppError('VERIFICATION_FAILED', `Flutterwave Verification Failed: ${result.message || 'Transaction not found or successful'}`, 400);
        }
        
        // Ensure the amount and currency match
        if (result.data.status !== 'successful') {
           throw new AppError('VERIFICATION_FAILED', `Transaction status is ${result.data.status}, expected successful`, 400);
        }
        
        if (Number(result.data.amount) < Number(dep.amount)) {
          throw new AppError('VERIFICATION_FAILED', `Amount mismatch. Paid: ${result.data.amount}, Expected: ${dep.amount}`, 400);
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('VERIFICATION_ERROR', 'Could not verify transaction with Flutterwave', 500);
      }
    } else {
      // If no Flutterwave secret is configured (e.g. testing), we'll bypass actual verification
      // and proceed with manual crediting based on admin's trust.
      console.warn('FLUTTERWAVE_SECRET not found, bypassing actual API verification for manual deposit approval.');
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

    await qr.query(`UPDATE "deposits" SET "status" = $1, "reviewed_by" = $2 WHERE "id" = $3`, [
      DepositStatus.completed,
      req.user!.id,
      dep.id,
    ]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: dep.user_id,
      title: 'Deposit Confirmed',
      message: `Your deposit of ${dep.amount} ${dep.currency} has been approved and credited.`,
      type: NotificationType.success,
      relatedId: dep.id,
    });

    const updated = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1`, [dep.id])) as Deposit[];

    const user = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [dep.user_id])) as User[];
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
      SELECT id, amount, currency, created_at 
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
      SELECT k.id, k.status, k.document_type, u.name as user_name
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
        disputes: disputeStats[0]
      },
      financials: {
        depositVolumes,
        withdrawalVolumes,
        tradeVolumes,
        escrowTVL
      },
      pendingDeposits,
      recentKyc,
      charts: {
        kycSubmissions: kycChart,
        deposits: depositChart,
        trades: tradeChart
      }
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
      }
    };
  });

  return ok(res, impact);
}

/**
 * List all deposits (System-wide)
 */
export async function listAllDeposits(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const deposits = await withTransaction(async (qr) => {
    return (await qr.query(
      `SELECT d.*, u.name as user_name, u.email as user_email 
       FROM "deposits" d 
       JOIN "users" u ON d.user_id = u.id 
       ORDER BY d.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, (parseInt(page) - 1) * parseInt(limit)],
    )) as Array<Record<string, unknown>>;
  });
  return ok(res, { deposits });
}

/**
 * List all disputes (System-wide)
 */
export async function listAllDisputes(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const disputes = await withTransaction(async (qr) => {
    return (await qr.query(
      `SELECT d.*, t.reference as trade_reference, u.name as raised_by_name 
       FROM "disputes" d 
       JOIN "trades" t ON d.trade_id = t.id 
       JOIN "users" u ON d.raised_by_id = u.id 
       ORDER BY d.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, (parseInt(page) - 1) * parseInt(limit)],
    )) as Array<Record<string, unknown>>;
  });
  return ok(res, { disputes });
}

/**
 * List all Transactions (System-wide Ledger)
 */
export async function listAllTransactions(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const transactions = await withTransaction(async (qr) => {
    return (await qr.query(
      `SELECT l.*, u.name as user_name 
       FROM "ledger" l 
       JOIN "users" u ON l.user_id = u.id 
       ORDER BY l.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, (parseInt(page) - 1) * parseInt(limit)],
    )) as Array<Record<string, unknown>>;
  });
  return ok(res, { transactions });
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
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function rejectDeposit(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  const deposit = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1 FOR UPDATE`, [id])) as Deposit[];
    const dep = rows[0];
    if (!dep) throw new NotFoundError('Deposit not found');

    if (dep.status === DepositStatus.completed) {
      throw new AppError('INVALID_STATUS', 'Cannot reject a completed deposit', 400);
    }

    await qr.query(`UPDATE "deposits" SET "status" = $1, "reviewed_by" = $2 WHERE "id" = $3`, [
      DepositStatus.rejected,
      req.user!.id,
      dep.id,
    ]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: dep.user_id,
      title: 'Deposit Rejected',
      message: `Your manual deposit of ${dep.amount} ${dep.currency} has been rejected.`,
      type: NotificationType.error,
      relatedId: dep.id,
    });

    const updated = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1`, [dep.id])) as Deposit[];
    return updated[0];
  });

  return ok(res, { deposit });
}

