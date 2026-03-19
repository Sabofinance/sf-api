import type { Request, Response } from 'express';
import { z } from 'zod';

import { Dispute } from '../../database/entities/Dispute';
import { Trade } from '../../database/entities/Trade';
import { withTransaction } from '../../database/transaction';
import { created, ok } from '../../utils/apiResponse';
import { TradeStatus } from '../../utils/enums';
import { AppError, NotFoundError, UnauthorizedError } from '../../utils/errors';

const raiseDisputeSchema = z.object({
  trade_id: z.string().uuid(),
  reason: z.string().min(20),
});

const idSchema = z.object({ id: z.string().uuid() });

/**
 * @swagger
 * /disputes/raise:
 *   post:
 *     summary: Raise a dispute for a trade
 *     tags: [Disputes]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [trade_id, reason]
 *             properties:
 *               trade_id: { type: string, format: "uuid" }
 *               reason: { type: string, example: "The seller has not responded after I made payment." }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function raiseDispute(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { trade_id, reason } = raiseDisputeSchema.parse(req.body);

  const dispute = await withTransaction(async (qr) => {
    const tradeRows = (await qr.query(
      `SELECT * FROM "trades" WHERE "id" = $1 FOR UPDATE`,
      [trade_id],
    )) as Trade[];
    const trade = tradeRows[0];

    if (!trade) throw new NotFoundError('Trade not found');
    if (trade.buyer_id !== req.user!.id && trade.seller_id !== req.user!.id) {
      throw new UnauthorizedError('You are not a party to this trade');
    }
    if (trade.status !== TradeStatus.escrowed && trade.status !== TradeStatus.confirmed) {
      throw new AppError('INVALID_STATUS', 'Disputes can only be raised on escrowed or confirmed trades', 400);
    }

    // Update trade status to disputed
    await qr.query(`UPDATE "trades" SET "status" = $1 WHERE "id" = $2`, [TradeStatus.disputed, trade_id]);

    // Create the dispute record
    const disputeRows = (await qr.query(
      `INSERT INTO "disputes" ("id", "trade_id", "raised_by_id", "reason")
       VALUES (gen_random_uuid(), $1, $2, $3)
       RETURNING *`,
      [trade_id, req.user!.id, reason],
    )) as Dispute[];

    return disputeRows[0];
  });

  return created(res, { dispute });
}

/**
 * @swagger
 * /disputes:
 *   get:
 *     summary: List disputes for the current user
 *     tags: [Disputes]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listUserDisputes(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();

  const disputes = await withTransaction(async (qr) => {
    return (await qr.query(
      `SELECT d.* FROM "disputes" d JOIN "trades" t ON d.trade_id = t.id WHERE t.buyer_id = $1 OR t.seller_id = $1 ORDER BY d.created_at DESC`,
      [req.user!.id],
    )) as Dispute[];
  });

  return ok(res, { disputes });
}

/**
 * @swagger
 * /disputes/{id}:
 *   get:
 *     summary: Get a specific dispute
 *     tags: [Disputes]
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
export async function getDispute(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);

  const dispute = await withTransaction(async (qr) => {
    const disputeRows = (await qr.query(
        `SELECT d.* FROM "disputes" d JOIN "trades" t ON d.trade_id = t.id WHERE d.id = $1 AND (t.buyer_id = $2 OR t.seller_id = $2)`,
        [id, req.user!.id]
    )) as Dispute[];

    if (disputeRows.length === 0) {
        throw new NotFoundError('Dispute not found or you do not have access');
    }
    return disputeRows[0];
  });

  return ok(res, { dispute });
}