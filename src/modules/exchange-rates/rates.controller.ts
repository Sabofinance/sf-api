import type { Request, Response } from 'express';

import { withTransaction } from '../../database/transaction';
import { ok } from '../../utils/apiResponse';

/**
 * @swagger
 * /rates:
 *   get:
 *     summary: Get latest exchange rates (latest row per pair)
 *     tags: [Exchange Rates]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getRates(_req: Request, res: Response) {
  const rates = await withTransaction(async (qr) => {
    return (await qr.query(
      `SELECT DISTINCT ON ("pair") * FROM "exchange_rates" ORDER BY "pair", "created_at" DESC, "id" DESC`,
    )) as Array<Record<string, unknown>>;
  });
  return ok(res, { rates });
}

