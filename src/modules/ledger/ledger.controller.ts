import type { Request, Response } from 'express';
import { z } from 'zod';

import { withTransaction } from '../../database/transaction';
import { ok } from '../../utils/apiResponse';
import { Currency, LedgerType } from '../../utils/enums';
import { UnauthorizedError } from '../../utils/errors';

const listSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  type: z.nativeEnum(LedgerType).optional(),
  currency: z.nativeEnum(Currency).optional(),
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
});

/**
 * @swagger
 * /ledger:
 *   get:
 *     summary: List ledger entries for authenticated user
 *     tags: [Ledger]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [deposit,withdrawal,trade_debit,trade_credit,escrow_hold,escrow_release,reversal,adjustment]
 *       - in: query
 *         name: currency
 *         schema: { $ref: "#/components/schemas/Currency" }
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
export async function listLedger(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const q = listSchema.parse(req.query);
  const pageNum = parseInt(q.page);
  const limitNum = parseInt(q.limit);
  const offset = (pageNum - 1) * limitNum;

  const result = await withTransaction(async (qr) => {
    const where: string[] = ['"user_id" = $1'];
    const args: unknown[] = [req.user!.id];
    let idx = 2;

    if (q.from) { where.push(`"created_at" >= $${idx++}`); args.push(q.from); }
    if (q.to)   { where.push(`"created_at" <= $${idx++}`); args.push(q.to); }
    if (q.type) { where.push(`"type" = $${idx++}`);        args.push(q.type); }
    if (q.currency) { where.push(`"currency" = $${idx++}`); args.push(q.currency); }

    const whereClause = where.join(' AND ');

    const [{ total }] = (await qr.query(
      `SELECT COUNT(*) as total FROM "ledger" WHERE ${whereClause}`,
      args,
    )) as [{ total: string }];

    args.push(limitNum, offset);
    const entries = (await qr.query(
      `SELECT * FROM "ledger" WHERE ${whereClause} ORDER BY "created_at" DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      args,
    )) as Array<Record<string, unknown>>;

    return { entries, total: parseInt(total) };
  });

  return ok(res, { entries: result.entries, total: result.total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /ledger/{walletId}:
 *   get:
 *     summary: List ledger entries for a wallet (owned by authenticated user)
 *     tags: [Ledger]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema: { type: string, format: uuid }
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
export async function listLedgerByWallet(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const walletId = z.string().uuid().parse(req.params.walletId);
  const { page, limit } = z.object({
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('20'),
  }).parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const result = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query(
      `SELECT COUNT(*) as total FROM "ledger" l JOIN "wallets" w ON w."id" = l."wallet_id" WHERE l."wallet_id" = $1 AND w."user_id" = $2`,
      [walletId, req.user!.id],
    )) as [{ total: string }];

    const entries = (await qr.query(
      `SELECT l.* FROM "ledger" l
       JOIN "wallets" w ON w."id" = l."wallet_id"
       WHERE l."wallet_id" = $1 AND w."user_id" = $2
       ORDER BY l."created_at" DESC LIMIT $3 OFFSET $4`,
      [walletId, req.user!.id, limitNum, offset],
    )) as Array<Record<string, unknown>>;

    return { entries, total: parseInt(total) };
  });

  return ok(res, { entries: result.entries, total: result.total, page: pageNum, limit: limitNum });
}
