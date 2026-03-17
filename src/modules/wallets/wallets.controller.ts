import type { Request, Response } from 'express';
import { z } from 'zod';

import { withTransaction } from '../../database/transaction';
import { ok } from '../../utils/apiResponse';
import { Currency } from '../../utils/enums';
import { NotFoundError, UnauthorizedError } from '../../utils/errors';

const currencyParam = z.object({ currency: z.nativeEnum(Currency) });

/**
 * @swagger
 * /wallets:
 *   get:
 *     summary: List user wallets
 *     tags: [Wallets]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listWallets(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const wallets = await withTransaction(async (qr) => {
    return (await qr.query(
      `SELECT "id","user_id","currency","balance","locked_balance","updated_at" FROM "wallets" WHERE "user_id" = $1 ORDER BY "currency" ASC`,
      [req.user!.id],
    )) as Array<Record<string, unknown>>;
  });
  return ok(res, { wallets });
}

/**
 * @swagger
 * /wallets/{currency}:
 *   get:
 *     summary: Get wallet by currency
 *     tags: [Wallets]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: currency
 *         required: true
 *         schema: { $ref: "#/components/schemas/Currency" }
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
export async function getWallet(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { currency } = currencyParam.parse(req.params);
  const wallet = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","user_id","currency","balance","locked_balance","updated_at" FROM "wallets" WHERE "user_id" = $1 AND "currency" = $2 LIMIT 1`,
      [req.user!.id, currency],
    )) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });
  if (!wallet) throw new NotFoundError('Wallet not found');
  return ok(res, { wallet });
}

