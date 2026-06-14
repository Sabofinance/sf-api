import Decimal from 'decimal.js';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { cloudinary } from '../../config/cloudinary';
import { Deposit } from '../../database/entities/Deposit';
import { User } from '../../database/entities/User';
import { withTransaction } from '../../database/transaction';
import { FlutterwaveProvider } from '../../providers/payments/FlutterwaveProvider';
import { sendEmail } from '../../services/emailService';
import { recordHeartbeat } from '../../services/reliability.service';
import { recordSecurityEvent } from '../../services/securityEvent.service';
import { NotificationService } from '../../services/notificationService';
import { nextReference } from '../../services/referenceService';
import { WalletService } from '../../services/walletService';
import { created, ok } from '../../utils/apiResponse';
import { Currency, DepositStatus, LedgerType, NotificationType } from '../../utils/enums';
import { AppError, NotFoundError, UnauthorizedError } from '../../utils/errors';
import { HeartbeatStatus, ReliabilityComponent, SecurityEventType } from '../../utils/observabilityEnums';

const initiateNgnSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  email: z.string().email().optional(),
});

const foreignDepositSchema = z.object({
  currency: z.enum([Currency.GBP, Currency.USD, Currency.CAD]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

/**
 * @swagger
 * /deposits/ngn/initiate:
 *   post:
 *     summary: Initiate NGN deposit (Flutterwave)
 *     tags: [Deposits]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: string, example: "5000.00" }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function initiateNgnDeposit(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const input = initiateNgnSchema.parse(req.body);

  const provider = new FlutterwaveProvider();

  const deposit = await withTransaction(async (qr) => {
    const reference = await nextReference(qr, 'DEP');
    const rows = (await qr.query(
      `INSERT INTO "deposits" ("id","reference","user_id","currency","amount","provider","provider_reference","proof_url","status","reviewed_by","created_at")
       VALUES (gen_random_uuid(), $1,$2,$3,$4,'flutterwave',NULL,NULL,$5,NULL, now())
       RETURNING *`,
      [reference, req.user!.id, Currency.NGN, input.amount, DepositStatus.initiated],
    )) as Deposit[];
    const dep = rows[0];
    const init = await provider.initiateDeposit({
      amount: input.amount,
      currency: Currency.NGN,
      customerEmail: input.email ?? req.user!.email,
      reference,
    });
    await qr.query(`UPDATE "deposits" SET "provider_reference" = $1 WHERE "id" = $2`, [
      init.provider_reference ?? null,
      dep.id,
    ]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: req.user!.id,
      title: 'Deposit Initiated',
      message: `Your deposit of ${input.amount} ${Currency.NGN} has been initiated.`,
      type: NotificationType.info,
      relatedId: dep.id,
    });

    return { ...dep, provider_reference: init.provider_reference ?? null, payment_link: init.payment_link ?? null };
  });

  return created(res, { deposit });
}

/**
 * @swagger
 * /webhooks/flutterwave:
 *   post:
 *     summary: Flutterwave webhook handler
 *     tags: [Deposits]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Always returns 200
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function flutterwaveWebhook(req: Request, res: Response) {
  const provider = new FlutterwaveProvider();
  const start = Date.now();

  try {
    await provider.handleWebhook(req.body, req.headers);

    const event = (req.body?.event ?? '') as string;
    if (event !== 'charge.completed') {
      await recordHeartbeat({
        component: ReliabilityComponent.webhook,
        status: HeartbeatStatus.ok,
        latencyMs: Date.now() - start,
        metadata: { event, skipped: true },
      });
      return ok(res, { received: true });
    }

    const data = req.body?.data ?? {};
    const reference = (data?.tx_ref ?? data?.reference ?? '') as string;
    const currency = String(data?.currency ?? '').toUpperCase();
    const webhookAmountRaw = data?.amount;

    if (!reference) {
      void recordSecurityEvent({
        eventType: SecurityEventType.webhook_malformed,
        req,
        details: { reason: 'missing_reference' },
      });
      return ok(res, { received: true });
    }

    const walletService = new WalletService();

    await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "reference" = $1 LIMIT 1`, [
        reference,
      ])) as Deposit[];
      const dep = rows[0];
      if (!dep) return;

      if (dep.status === DepositStatus.completed) {
        void recordSecurityEvent({
          eventType: SecurityEventType.webhook_replay,
          req,
          details: { reference, depositId: dep.id },
        });
        return;
      }
      const depCurrency = String(dep.currency).toUpperCase();
      if (depCurrency !== currency)
        throw new AppError('CURRENCY_MISMATCH', 'Payment currency does not match the deposit record you are completing.', 400);
      const depAmt = new Decimal(String(dep.amount));
      const paidAmt = new Decimal(String(webhookAmountRaw ?? 0));
      if (!depAmt.equals(paidAmt))
        throw new AppError('AMOUNT_MISMATCH', 'Payment amount does not match the deposit amount on file.', 400);

      await walletService.credit({
        queryRunner: qr,
        userId: dep.user_id,
        currency: dep.currency,
        amount: dep.amount,
        type: LedgerType.deposit,
        initiatedBy: dep.user_id,
        relatedId: dep.id,
        reference: dep.reference,
      });

      await qr.query(`UPDATE "deposits" SET "status" = $1, "provider_reference" = $2, "reviewed_at" = NOW() WHERE "id" = $3`, [
        DepositStatus.completed,
        String(data?.id ?? dep.provider_reference ?? dep.reference),
        dep.id,
      ]);

      const notificationService = new NotificationService();
      await notificationService.createNotification({
        queryRunner: qr,
        userId: dep.user_id,
        title: 'Deposit Confirmed',
        message: `Your deposit of ${dep.amount} ${dep.currency} has been successfully credited to your wallet.`,
        type: NotificationType.success,
        relatedId: dep.id,
      });

      const userRows = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [dep.user_id])) as User[];
      if (userRows.length > 0 && userRows[0].email) {
        await sendEmail({
          to: userRows[0].email,
          subject: 'Deposit Confirmed',
          template: 'deposit-confirmation',
          context: {
            name: userRows[0].name,
            amount: dep.amount,
            currency: dep.currency,
            reference: dep.reference,
          },
        });
      }
    });

    await recordHeartbeat({
      component: ReliabilityComponent.webhook,
      status: HeartbeatStatus.ok,
      latencyMs: Date.now() - start,
      metadata: { reference, provider: 'flutterwave' },
    });
  } catch (err) {
    const appErr = err as AppError;
    if (appErr instanceof AppError) {
      if (appErr.code === 'WEBHOOK_SIGNATURE_INVALID' || appErr.code === 'WEBHOOK_SIGNATURE_MISSING') {
        void recordSecurityEvent({
          eventType: SecurityEventType.webhook_invalid_signature,
          req,
          details: { code: appErr.code },
        });
      } else {
        void recordSecurityEvent({
          eventType: SecurityEventType.webhook_malformed,
          req,
          details: { code: appErr.code, message: appErr.message },
        });
      }
    }
    await recordHeartbeat({
      component: ReliabilityComponent.webhook,
      status: HeartbeatStatus.failed,
      latencyMs: Date.now() - start,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return ok(res, { received: true });
  }

  return ok(res, { received: true });
}

/**
 * @swagger
 * /deposits:
 *   get:
 *     summary: List deposits for authenticated user
 *     tags: [Deposits]
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

export async function listDeposits(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const result = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query(
      `SELECT COUNT(*) as total FROM "deposits" WHERE "user_id" = $1`,
      [req.user!.id],
    )) as [{ total: string }];

    const deposits = (await qr.query(
      `SELECT * FROM "deposits" WHERE "user_id" = $1 ORDER BY "created_at" DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, limitNum, offset],
    )) as Array<Record<string, unknown>>;

    return { deposits, total: parseInt(total) };
  });

  return ok(res, { items: result.deposits, deposits: result.deposits, total: result.total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /deposits/{id}:
 *   get:
 *     summary: Get deposit by id
 *     tags: [Deposits]
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
 *       404:
 *         description: Not found
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function getDeposit(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const id = z.string().uuid().parse(req.params.id);
  const deposit = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 AND "user_id" = $2 LIMIT 1`, [
      id,
      req.user!.id,
    ])) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });
  if (!deposit) throw new NotFoundError('No deposit request matches that ID on your account.', 'DEPOSIT_NOT_FOUND');
  return ok(res, { deposit });
}

/**
 * @swagger
 * /deposits/foreign:
 *   post:
 *     summary: Submit manual foreign currency deposit (GBP/USD/CAD)
 *     tags: [Deposits]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [currency, amount, proof]
 *             properties:
 *               currency: { $ref: "#/components/schemas/Currency" }
 *               amount: { type: string, example: "100.00" }
 *               proof: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function submitForeignDeposit(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();

  const input = foreignDepositSchema.parse(req.body);
  const file = req.file as Express.Multer.File | undefined;
  if (!file) throw new AppError('PROOF_REQUIRED', 'Attach a clear proof-of-payment image or PDF.', 400);

  if (!cloudinary.config().cloud_name) {
    throw new AppError('CONFIG_ERROR', 'CLOUDINARY_URL is required for proof uploads', 500);
  }

  const uploaded = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`, {
    folder: 'sabo-finance/deposits',
    resource_type: 'image',
  });

  const deposit = await withTransaction(async (qr) => {
    const reference = await nextReference(qr, 'DEP');
    const rows = (await qr.query(
      `INSERT INTO "deposits" ("id","reference","user_id","currency","amount","provider","provider_reference","proof_url","status","reviewed_by","created_at")
       VALUES (gen_random_uuid(), $1,$2,$3,$4,'manual',NULL,$5,$6,NULL, now())
       RETURNING *`,
      [reference, req.user!.id, input.currency, input.amount, uploaded.secure_url, DepositStatus.pending_review],
    )) as Array<Record<string, unknown>>;

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: req.user!.id,
      title: 'Deposit Submitted',
      message: `Your manual deposit of ${input.amount} ${input.currency} has been submitted for review.`,
      type: NotificationType.info,
      relatedId: rows[0].id as string,
    });

    return rows[0];
  });

  return created(res, { deposit });
}

/**
 * @swagger
 * /deposits/{id}/cancel:
 *   post:
 *     summary: Cancel an initiated deposit
 *     tags: [Deposits]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 */
export async function cancelDeposit(req: Request, res: Response) {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const deposit = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 AND "user_id" = $2 LIMIT 1 FOR UPDATE`, [
      id,
      req.user!.id,
    ])) as Deposit[];
    const dep = rows[0];

    if (!dep) throw new NotFoundError('Deposit not found');
    if (dep.status !== DepositStatus.initiated) {
      throw new AppError('INVALID_STATUS', 'Only initiated deposits can be cancelled.', 400);
    }

    await qr.query(`UPDATE "deposits" SET "status" = $1 WHERE "id" = $2`, [
      DepositStatus.failed, // Using failed as we don't have a cancelled status for deposits yet, or use expired.
      dep.id,
    ]);

    return { ...dep, status: DepositStatus.failed };
  });

  return ok(res, { deposit });
}

