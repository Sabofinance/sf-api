import type { Request, Response } from 'express';
import { z } from 'zod';

import { Beneficiary } from '../../database/entities/Beneficiary';
import { Withdrawal } from '../../database/entities/Withdrawal';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { NotificationService } from '../../services/notificationService';
import { requirePinSet, verifyPin } from '../../services/pinService';
import { nextReference } from '../../services/referenceService';
import { WalletService } from '../../services/walletService';
import { created, ok } from '../../utils/apiResponse';
import { LedgerType, NotificationType } from '../../utils/enums';
import { AppError, NotFoundError, UnauthorizedError } from '../../utils/errors';

const requestSchema = z.object({
  beneficiary_id: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits'),
});

const idSchema = z.object({ id: z.string().uuid() });

/**
 * @swagger
 * /withdrawals/request:
 *   post:
 *     summary: Request a new withdrawal
 *     tags: [Withdrawals]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [beneficiary_id, amount, pin]
 *             properties:
 *               beneficiary_id: { type: string, format: "uuid" }
 *               amount: { type: string, example: "10000.00" }
 *               pin: { type: string, example: "123456" }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function requestWithdrawal(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const input = requestSchema.parse(req.body);

  const walletService = new WalletService();

  const withdrawal = await withTransaction(async (qr) => {
    await requirePinSet(req.user!.id, qr);
    const pinValid = await verifyPin(req.user!.id, input.pin, qr);
    if (!pinValid) {
      throw new AppError('INVALID_PIN', 'The transaction PIN you entered is incorrect.', 401);
    }

    const beneficiaryRows = (await qr.query(
      `SELECT "id", "currency" FROM "beneficiaries" WHERE "id" = $1 AND "user_id" = $2`,
      [input.beneficiary_id, req.user!.id],
    )) as Beneficiary[];

    const beneficiary = beneficiaryRows[0];
    if (!beneficiary) {
      throw new NotFoundError('No saved beneficiary matches that ID on your account.', 'BENEFICIARY_NOT_FOUND');
    }

    const reference = await nextReference(qr, 'WDR');

    await walletService.debit({
      queryRunner: qr,
      userId: req.user!.id,
      currency: beneficiary.currency,
      amount: input.amount,
      type: LedgerType.withdrawal,
      initiatedBy: req.user!.id,
      reference,
    });

    const withdrawalRows = (await qr.query(
      `INSERT INTO "withdrawals" ("id","reference","user_id","beneficiary_id","currency","amount")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING *`,
      [reference, req.user!.id, beneficiary.id, beneficiary.currency, input.amount],
    )) as Withdrawal[];

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: req.user!.id,
      title: 'Withdrawal Requested',
      message: `Your withdrawal request of ${input.amount} ${beneficiary.currency} has been received.`,
      type: NotificationType.info,
      relatedId: withdrawalRows[0].id,
    });

    await sendEmail({
      to: req.user!.email,
      subject: 'Withdrawal Request Received',
      template: 'withdrawal-status',
      context: {
        name: req.user!.name,
        status: 'Requested',
        statusClass: 'requested',
        message: 'Your withdrawal request has been received and is now pending review.',
        amount: input.amount,
        currency: beneficiary.currency,
        reference,
      },
    });

    return withdrawalRows[0];
  });

  return created(res, { withdrawal });
}

/**
 * @swagger
 * /withdrawals:
 *   get:
 *     summary: List user withdrawals
 *     tags: [Withdrawals]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
const paginationSchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
});

export async function listWithdrawals(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const result = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query(
      `SELECT COUNT(*) as total FROM "withdrawals" WHERE "user_id" = $1`,
      [req.user!.id],
    )) as [{ total: string }];

    const withdrawals = (await qr.query(
      `SELECT * FROM "withdrawals" WHERE "user_id" = $1 ORDER BY "created_at" DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, limitNum, offset],
    )) as Withdrawal[];

    return { withdrawals, total: parseInt(total) };
  });

  return ok(res, { withdrawals: result.withdrawals, total: result.total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /withdrawals/{id}:
 *   get:
 *     summary: Get a specific withdrawal
 *     tags: [Withdrawals]
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
export async function getWithdrawal(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);

  const withdrawal = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "withdrawals" WHERE "id" = $1 AND "user_id" = $2`, [
      id,
      req.user!.id,
    ])) as Withdrawal[];
    if (rows.length === 0) {
      throw new NotFoundError('No withdrawal request matches that reference on your account.', 'WITHDRAWAL_NOT_FOUND');
    }
    return rows[0];
  });

  return ok(res, { withdrawal });
}