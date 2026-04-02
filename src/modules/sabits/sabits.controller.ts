import Decimal from 'decimal.js';
import type { Request, Response } from 'express';
import { z } from 'zod';


import { Sabit } from '../../database/entities/Sabit';
import { withTransaction } from '../../database/transaction';
import { requirePinSet } from '../../services/pinService';
import { WalletService } from '../../services/walletService';
import { created, ok } from '../../utils/apiResponse';
import { Currency, LedgerType, SabitStatus, SabitType } from '../../utils/enums';
import { AppError, NotFoundError, UnauthorizedError } from '../../utils/errors';

const createSchema = z.object({
  type: z.nativeEnum(SabitType),
  currency: z.enum([Currency.GBP, Currency.USD, Currency.CAD]), // NGN is the quote currency
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  rate_ngn: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const listSchema = z.object({
  type: z.nativeEnum(SabitType).optional(),
  currency: z.nativeEnum(Currency).optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

/**
 * @swagger
 * /sabits:
 *   post:
 *     summary: Create a new Sabit (P2P listing)
 *     tags: [Sabits]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, currency, amount, rate_ngn]
 *             properties:
 *               type: { $ref: "#/components/schemas/SabitType" }
 *               currency: { $ref: "#/components/schemas/Currency" }
 *               amount: { type: string, example: "100.00" }
 *               rate_ngn: { type: string, example: "1500.00" }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function createSabit(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const input = createSchema.parse(req.body);
  const amount = new Decimal(input.amount);

  const walletService = new WalletService();

  const sabit = await withTransaction(async (qr) => {
    // Lock funds based on sabit type
    if (input.type === SabitType.SELL) {
      await requirePinSet(req.user!.id, qr, 'You must set a transaction PIN before creating a SELL sabit');
      // Seller is selling foreign currency, so lock their foreign currency wallet
      await walletService.lock({
        queryRunner: qr,
        userId: req.user!.id,
        currency: input.currency,
        amount: input.amount,
        type: LedgerType.escrow_hold,
        initiatedBy: req.user!.id,
      });
    } else {
      // Buyer is buying foreign currency with NGN, so lock their NGN wallet
      const ngnAmount = amount.times(new Decimal(input.rate_ngn));
      await walletService.lock({
        queryRunner: qr,
        userId: req.user!.id,
        currency: Currency.NGN,
        amount: ngnAmount.toFixed(2),
        type: LedgerType.escrow_hold,
        initiatedBy: req.user!.id,
      });
    }

    // Create the sabit
    const sabitRows = (await qr.query(
      `INSERT INTO "sabits" ("id","user_id","type","currency","amount","available_amount","rate_ngn")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user!.id, input.type, input.currency, input.amount, input.amount, input.rate_ngn],
    )) as Sabit[];

    return sabitRows[0];
  });

  return created(res, { sabit });
}

/**
 * @swagger
 * /sabits:
 *   get:
 *     summary: List active Sabits (P2P listings)
 *     tags: [Sabits]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { $ref: "#/components/schemas/SabitType" }
 *       - in: query
 *         name: currency
 *         schema: { $ref: "#/components/schemas/Currency" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listSabits(req: Request, res: Response) {
  const { type, currency } = listSchema.parse(req.query);

  const sabits = await withTransaction(async (qr) => {
    let query = `
      SELECT 
        s.*, 
        u.username as user_username, 
        u.profile_picture_url as user_profile_picture 
      FROM "sabits" s 
      JOIN "users" u ON s.user_id = u.id 
      WHERE s."status" = 'active'`;
    const params = [];
    if (type) {
      params.push(type);
      query += ` AND s."type" = ${params.length}`;
    }
    if (currency) {
      params.push(currency);
      query += ` AND s."currency" = ${params.length}`;
    }
    query += ` ORDER BY s."created_at" DESC`;
    return (await qr.query(query, params)) as Array<Sabit & { user_username: string; user_profile_picture: string | null }>;
  });

  return ok(res, { sabits });
}

/**
 * @swagger
 * /sabits/{id}:
 *   get:
 *     summary: Get a specific Sabit
 *     tags: [Sabits]
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
export async function getSabit(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  const sabit = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT 
        s.*, 
        u.username as user_username, 
        u.profile_picture_url as user_profile_picture 
      FROM "sabits" s 
      JOIN "users" u ON s.user_id = u.id 
      WHERE s."id" = $1`,
      [id],
    )) as Array<Sabit & { user_username: string; user_profile_picture: string | null }>;
    if (rows.length === 0) {
      throw new NotFoundError('No listing exists with that ID.', 'SABIT_NOT_FOUND');
    }
    return rows[0];
  });
  return ok(res, { sabit });
}

/**
 * @swagger
 * /sabits/{id}/cancel:
 *   post:
 *     summary: Cancel a Sabit
 *     tags: [Sabits]
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
export async function cancelSabit(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);

  const walletService = new WalletService();

  await withTransaction(async (qr) => {
    const sabitRows = (await qr.query(
      `SELECT * FROM "sabits" WHERE "id" = $1 AND "user_id" = $2 FOR UPDATE`,
      [id, req.user!.id],
    )) as Sabit[];
    const sabit = sabitRows[0];

    if (!sabit) throw new NotFoundError('No listing exists with that ID on your account.', 'SABIT_NOT_FOUND');
    if (sabit.status !== SabitStatus.active) {
      throw new AppError('INVALID_STATUS', 'Only active listings can be cancelled.', 400);
    }

    // Unlock the remaining available amount
    const availableAmount = new Decimal(sabit.available_amount);
    if (availableAmount.gt(0)) {
      if (sabit.type === SabitType.SELL) {
        await walletService.unlock({
          queryRunner: qr,
          userId: req.user!.id,
          currency: sabit.currency,
          amount: availableAmount.toFixed(2),
          type: LedgerType.escrow_release,
          initiatedBy: req.user!.id,
        });
      } else {
        const ngnAmount = availableAmount.times(new Decimal(sabit.rate_ngn));
        await walletService.unlock({
          queryRunner: qr,
          userId: req.user!.id,
          currency: Currency.NGN,
          amount: ngnAmount.toFixed(2),
          type: LedgerType.escrow_release,
          initiatedBy: req.user!.id,
        });
      }
    }

    await qr.query(`UPDATE "sabits" SET "status" = $1, "available_amount" = '0' WHERE "id" = $2`, [
      SabitStatus.cancelled,
      id,
    ]);
  });

  return ok(res, { message: 'Sabit cancelled successfully' });
}