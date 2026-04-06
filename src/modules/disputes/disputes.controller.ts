import type { Request, Response } from 'express';
import { z } from 'zod';

import { Dispute } from '../../database/entities/Dispute';
import { Trade } from '../../database/entities/Trade';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { NotificationService } from '../../services/notificationService';
import { created, ok } from '../../utils/apiResponse';
import { NotificationType, TradeStatus } from '../../utils/enums';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../utils/errors';

const raiseDisputeSchema = z.object({
  trade_id: z.string().uuid(),
  reason: z.string().min(20),
});

const idSchema = z.object({ id: z.string().uuid() });
const paginationSchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
});

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

    if (!trade) throw new NotFoundError('No trade exists with that ID.', 'TRADE_NOT_FOUND');
    if (trade.buyer_id !== req.user!.id && trade.seller_id !== req.user!.id) {
      throw new ForbiddenError('Only the buyer or seller can open a dispute for this trade.', 'NOT_TRADE_PARTY');
    }
    if (trade.status === TradeStatus.disputed) {
      throw new AppError('ALREADY_DISPUTED', 'A dispute has already been opened for this trade.', 400);
    }
    if (trade.status !== TradeStatus.escrowed && trade.status !== TradeStatus.confirmed) {
      throw new AppError(
        'INVALID_STATUS',
        'Disputes can only be opened while the trade is in escrow or confirmed (not completed or cancelled).',
        400,
      );
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

    const dispute = disputeRows[0];

    // Notify the counterparty
    const counterpartyId = trade.buyer_id === req.user!.id ? trade.seller_id : trade.buyer_id;
    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: counterpartyId,
      title: 'Dispute Opened',
      message: `A dispute has been raised on trade ${trade.reference}. Our support team will review it shortly.`,
      type: NotificationType.warning,
      relatedId: dispute.id,
    });

    const counterpartyRows = await qr.query(`SELECT email, name FROM "users" WHERE "id" = $1`, [counterpartyId]);
    if (counterpartyRows.length > 0) {
      await sendEmail({
        to: counterpartyRows[0].email,
        subject: `Dispute Opened on Trade ${trade.reference}`,
        template: 'dispute-raised',
        context: { name: counterpartyRows[0].name, reference: trade.reference },
      });
    }

    return dispute;
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
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const result = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query(
      `SELECT COUNT(*) as total FROM "disputes" d JOIN "trades" t ON d.trade_id = t.id WHERE t.buyer_id = $1 OR t.seller_id = $1`,
      [req.user!.id],
    )) as [{ total: string }];

    const disputes = (await qr.query(
      `SELECT d.*,
              t.reference  AS trade_reference,
              t.currency   AS trade_currency,
              t.amount     AS trade_amount,
              t.total_ngn  AS trade_total_ngn,
              t.status     AS trade_status
       FROM "disputes" d
       JOIN "trades" t ON d.trade_id = t.id
       WHERE t.buyer_id = $1 OR t.seller_id = $1
       ORDER BY d.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user!.id, limitNum, offset],
    )) as Array<Record<string, unknown>>;

    return { disputes, total: parseInt(total) };
  });

  return ok(res, { disputes: result.disputes, total: result.total, page: pageNum, limit: limitNum });
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
      `SELECT d.*,
              t.reference  AS trade_reference,
              t.currency   AS trade_currency,
              t.amount     AS trade_amount,
              t.total_ngn  AS trade_total_ngn,
              t.status     AS trade_status
       FROM "disputes" d
       JOIN "trades" t ON d.trade_id = t.id
       WHERE d.id = $1 AND (t.buyer_id = $2 OR t.seller_id = $2)`,
      [id, req.user!.id],
    )) as Array<Record<string, unknown>>;

    if (disputeRows.length === 0) {
      throw new NotFoundError('No dispute with that ID was found on your account.', 'DISPUTE_NOT_FOUND');
    }
    return disputeRows[0];
  });

  return ok(res, { dispute });
}