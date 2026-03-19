import type { Request, Response } from 'express';
import { z } from 'zod';

import { cloudinary } from '../../config/cloudinary';
import { Deposit } from '../../database/entities/Deposit';
import { User } from '../../database/entities/User';
import { withTransaction } from '../../database/transaction';
import { FlutterwaveProvider } from '../../providers/payments/FlutterwaveProvider';
import { sendEmail } from '../../services/emailService';
import { nextReference } from '../../services/referenceService';
import { WalletService } from '../../services/walletService';
import { created, ok } from '../../utils/apiResponse';
import { Currency, DepositStatus, LedgerType } from '../../utils/enums';
import { AppError, NotFoundError, UnauthorizedError } from '../../utils/errors';

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
      customerEmail: input.email ?? '',
      reference,
    });
    await qr.query(`UPDATE "deposits" SET "provider_reference" = $1 WHERE "id" = $2`, [
      init.provider_reference ?? null,
      dep.id,
    ]);
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

  try {
    await provider.handleWebhook(req.body, req.headers);

    const event = (req.body?.event ?? '') as string;
    if (event !== 'charge.completed') {
      return ok(res, { received: true });
    }

    const data = req.body?.data ?? {};
    const reference = (data?.tx_ref ?? data?.reference ?? '') as string;
    const currency = (data?.currency ?? '') as string;
    const amount = String(data?.amount ?? '');

    if (!reference) return ok(res, { received: true });

    const walletService = new WalletService();

    await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "reference" = $1 LIMIT 1`, [
        reference,
      ])) as Deposit[];
      const dep = rows[0];
      if (!dep) return;

      if (dep.status === DepositStatus.completed) return;
      if (String(dep.currency) !== currency) throw new AppError('CURRENCY_MISMATCH', 'Currency mismatch', 400);
      if (String(dep.amount) !== amount) throw new AppError('AMOUNT_MISMATCH', 'Amount mismatch', 400);

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

      await qr.query(`UPDATE "deposits" SET "status" = $1, "provider_reference" = $2 WHERE "id" = $3`, [
        DepositStatus.completed,
        String(data?.id ?? dep.provider_reference ?? dep.reference),
        dep.id,
      ]);

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
  } catch {
    // Always return 200 to webhook.
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
export async function listDeposits(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const deposits = await withTransaction(async (qr) => {
    return (await qr.query(`SELECT * FROM "deposits" WHERE "user_id" = $1 ORDER BY "created_at" DESC LIMIT 200`, [
      req.user!.id,
    ])) as Array<Record<string, unknown>>;
  });
  return ok(res, { deposits });
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
  if (!deposit) throw new NotFoundError('Deposit not found');
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
  if (!file) throw new AppError('PROOF_REQUIRED', 'Proof file is required', 400);

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
    return rows[0];
  });

  return created(res, { deposit });
}

