import crypto from 'crypto';

import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../../config/env';
import { cloudinary } from '../../config/cloudinary';
import { Deposit } from '../../database/entities/Deposit';
import { Kyc } from '../../database/entities/Kyc';
import { User } from '../../database/entities/User';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { NotificationService } from '../../services/notificationService';
import { WalletService } from '../../services/walletService';
import { ok } from '../../utils/apiResponse';
import { Currency, DepositStatus, KycStatus, LedgerType, NotificationType, UserRole } from '../../utils/enums';
import { AppError, NotFoundError } from '../../utils/errors';

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
      `SELECT "id","password_hash","role","email","name","kyc_status","is_suspended","deleted_at" FROM "users" WHERE "email" = $1 AND ("role" = $2 OR "role" = $3) LIMIT 1`,
      [input.email.toLowerCase(), UserRole.admin, UserRole.super_admin],
    )) as Array<{ id: string; password_hash: string; role: UserRole; email: string; name: string; kyc_status: string; is_suspended: boolean; deleted_at: Date | null; }>;
    return rows[0];
  });

  if (!user) throw new AppError('INVALID_ADMIN_CREDENTIALS', 'Invalid admin email or password.', 401);
  if (user.deleted_at) throw new AppError('ACCOUNT_DELETED', 'This account has been deleted.', 401);
  if (user.is_suspended) throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.', 401);

  const okPass = await bcrypt.compare(input.password, user.password_hash);
  if (!okPass) throw new AppError('INVALID_ADMIN_CREDENTIALS', 'Invalid admin email or password.', 401);

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
    )) as Array<{ id: string; name: string; email: string; role: UserRole; kyc_status: string; is_suspended: boolean; deleted_at: Date | null }>;

    return rows[0];
  });

  if (!user) {
    throw new AppError('INVALID_OTP', 'That admin sign-in code is incorrect or has expired. Request a new OTP.', 400);
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
    if (userRows.length === 0) throw new NotFoundError('No user exists with that ID.', 'USER_NOT_FOUND');
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

    if (already.length > 0 && (already[0].role === UserRole.admin || already[0].role === UserRole.super_admin) && !already[0].deleted_at) {
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
    if (!invite) throw new AppError('INVITE_EXPIRED_OR_INVALID', 'Invite token is invalid or expired', 400);

    const userRows = (await qr.query(
      `SELECT "id","name","email","role","deleted_at" FROM "users" WHERE "email" = $1 AND "deleted_at" IS NULL LIMIT 1 FOR UPDATE`,
      [invite.invited_email],
    )) as Array<{ id: string; name: string; email: string; role: UserRole; deleted_at: Date | null }>;

    const user = userRows[0];
    if (!user) {
      // Invite remains unconsumed until a matching user is available.
      return { accepted: false, inviteId: invite.id, invitedEmail: invite.invited_email };
    }

    await qr.query(`UPDATE "users" SET "role" = $1 WHERE "id" = $2`, [invite.granted_role, user.id]);
    await qr.query(
      `UPDATE "admin_invites" SET "consumed_at" = now(), "consumed_by" = $1 WHERE "id" = $2`,
      [user.id, invite.id],
    );

    await qr.query(
      `INSERT INTO "admin_logs" ("id","admin_id","action","target_type","target_id","details","created_at")
       VALUES (gen_random_uuid(), $1, 'ADMIN_INVITE_ACCEPTED', 'user', $2, $3, now())`,
      [invite.inviter_id, user.id, JSON.stringify({ inviteId: invite.id, acceptedUserId: user.id })],
    );

    return { accepted: true, inviteId: invite.id, userId: user.id, name: user.name, email: user.email };
  });

  if (!result.accepted) {
    return ok(res, { message: 'Invite is valid. Register your account with the invited email to accept.' });
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
    )) as Array<{ id: string; name: string; email: string; role: UserRole; deleted_at: Date | null }>;
    const user = rows[0];
    if (!user) throw new NotFoundError('No user with that ID was found.', 'USER_NOT_FOUND');
    if (user.role !== UserRole.admin)
      throw new AppError('NOT_ADMIN', 'That user is not currently an admin, so their admin role cannot be removed.', 400);

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
    )) as Array<{ id: string; email: string; role: UserRole; deleted_at: Date | null; name: string }>;
    const user = rows[0];
    if (!user) throw new NotFoundError('No user with that ID was found.', 'USER_NOT_FOUND');

    if (user.role !== UserRole.admin)
      throw new AppError('NOT_ADMIN', 'Only users who are already admins can be upgraded to super admin.', 400);

    await qr.query(`UPDATE "users" SET "role" = $1 WHERE "id" = $2`, [UserRole.super_admin, user.id]);
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
 * /admin/profile:
 *   get:
 *     summary: Get admin profile
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
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

  const uploaded = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`, {
    folder: 'sabo-finance/admin-profile',
    resource_type: 'image',
  });

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
 */
export async function listAdminLogs(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const actorId = req.user!.id;
  const isSuper = req.user!.role === UserRole.super_admin;

  const logs = await withTransaction(async (qr) => {
    const params: unknown[] = [];
    let query = `SELECT * FROM "admin_logs"`;
    if (!isSuper) {
      query += ` WHERE "admin_id" = $1`;
      params.push(actorId);
    }
    query += ` ORDER BY "created_at" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    return qr.query(query, params);
  });

  return ok(res, { logs });
}

