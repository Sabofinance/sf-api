import type { Request, Response } from 'express';
import { z } from 'zod';

import { Deposit } from '../../database/entities/Deposit';
import { Kyc } from '../../database/entities/Kyc';
import { User } from '../../database/entities/User';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { NotificationService } from '../../services/notificationService';
import { WalletService } from '../../services/walletService';
import { ok } from '../../utils/apiResponse';
import { DepositStatus, KycStatus, LedgerType, NotificationType } from '../../utils/enums';
import { AppError, NotFoundError } from '../../utils/errors';

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
    if (dep.status !== DepositStatus.pending_review) {
      throw new AppError('INVALID_STATUS', 'Deposit is not pending review', 400);
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
      message: `Your manual deposit of ${dep.amount} ${dep.currency} has been approved and credited.`,
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

