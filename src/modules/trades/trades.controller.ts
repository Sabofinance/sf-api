import Decimal from 'decimal.js';
import type { Request, Response } from 'express';
import { z } from 'zod';


import { Sabit } from '../../database/entities/Sabit';
import { Trade } from '../../database/entities/Trade';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { NotificationService } from '../../services/notificationService';
import { requirePinSet, verifyPin } from '../../services/pinService';
import { nextReference } from '../../services/referenceService';
import { WalletService } from '../../services/walletService';
import { created, ok } from '../../utils/apiResponse';
import { Currency, LedgerType, SabitStatus, SabitType, TradeStatus, NotificationType } from '../../utils/enums';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../utils/errors';

const initiateSchema = z.object({
  sabit_id: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits'),
});

const idSchema = z.object({ id: z.string().uuid() });

const sellerConfirmSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits'),
});

const listTradesSchema = z.object({
  page: z.string().regex(/^\d+$/).default('1'),
  limit: z.string().regex(/^\d+$/).default('20'),
  status: z.nativeEnum(TradeStatus).optional(),
});

/**
 * @swagger
 * /trades:
 *   get:
 *     summary: List all trades for the authenticated user
 *     tags: [Trades]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: string, default: "1" }
 *       - in: query
 *         name: limit
 *         schema: { type: string, default: "20" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: ["initiated", "confirmed", "escrowed", "completed", "cancelled", "disputed"] }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listUserTrades(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { page, limit, status } = listTradesSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const { trades, total } = await withTransaction(async (qr) => {
    let baseWhere = `WHERE (t.buyer_id = $1 OR t.seller_id = $1)`;
    const params: any[] = [req.user!.id];

    if (status) {
      baseWhere += ` AND t.status = $2`;
      params.push(status);
    }

    const [{ total }] = (await qr.query(
      `SELECT COUNT(*) as total FROM "trades" t ${baseWhere}`,
      params,
    )) as [{ total: string }];

    let query = `
      SELECT t.*, 
             s.currency as sabit_currency, s.rate_ngn as sabit_rate,
             u_buyer.name as buyer_name, u_seller.name as seller_name
      FROM "trades" t
      JOIN "sabits" s ON t.sabit_id = s.id
      JOIN "users" u_buyer ON t.buyer_id = u_buyer.id
      JOIN "users" u_seller ON t.seller_id = u_seller.id
      ${baseWhere}
      ORDER BY t.created_at DESC 
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limitNum, offset);

    const trades = (await qr.query(query, params)) as Trade[];
    return { trades, total: parseInt(total) };
  });

  return ok(res, { items: trades, trades, total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /trades/{id}:
 *   get:
 *     summary: Get a single trade by ID
 *     tags: [Trades]
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
export async function getTrade(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);

  const trade = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT t.*, 
              s.currency as sabit_currency, s.rate_ngn as sabit_rate,
              u_buyer.name as buyer_name, u_seller.name as seller_name
       FROM "trades" t
       JOIN "sabits" s ON t.sabit_id = s.id
       JOIN "users" u_buyer ON t.buyer_id = u_buyer.id
       JOIN "users" u_seller ON t.seller_id = u_seller.id
       WHERE t.id = $1 AND (t.buyer_id = $2 OR t.seller_id = $2)
       LIMIT 1`,
      [id, req.user!.id],
    )) as Trade[];

    return rows[0];
  });

  if (!trade) {
    throw new NotFoundError('No trade exists with that ID or you are not a party to it.', 'TRADE_NOT_FOUND');
  }

  return ok(res, { trade });
}

/**
 * @swagger
 * /trades/initiate:
 *   post:
 *     summary: Initiate a new trade against a Sabit
 *     tags: [Trades]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sabit_id, amount, pin]
 *             properties:
 *               sabit_id: { type: string, format: "uuid" }
 *               amount: { type: string, example: "50.00" }
 *               pin: { type: string, example: "123456" }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function initiateTrade(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const input = initiateSchema.parse(req.body);
  const amount = new Decimal(input.amount);

  const trade = await withTransaction(async (qr) => {
    const sabitRows = (await qr.query(
      `SELECT * FROM "sabits" WHERE "id" = $1 AND "status" = 'active' FOR UPDATE`,
      [input.sabit_id],
    )) as Sabit[];
    const sabit = sabitRows[0];

    if (!sabit) throw new NotFoundError('That listing is not available or is no longer active.', 'SABIT_NOT_FOUND');
    if (new Decimal(sabit.available_amount).lt(amount)) {
      throw new AppError(
        'INSUFFICIENT_SABIT_AMOUNT',
        'Trade amount is higher than the remaining amount on this listing.',
        400,
      );
    }

    const buyerId = sabit.type === SabitType.SELL ? req.user!.id : sabit.user_id;
    const sellerId = sabit.type === SabitType.SELL ? sabit.user_id : req.user!.id;

    if (buyerId === sellerId) {
      throw new AppError('SELF_TRADE_NOT_ALLOWED', 'You cannot open a trade against your own listing.', 400);
    }

    await requirePinSet(buyerId, qr);
    await requirePinSet(sellerId, qr, 'The seller has not set a transaction PIN. This trade cannot proceed.');

    const pinValid = await verifyPin(req.user!.id, input.pin, qr);
    if (!pinValid) {
      throw new AppError('INVALID_PIN', 'The transaction PIN you entered is incorrect.', 401);
    }

    const walletService = new WalletService();
    const totalNgn = amount.times(new Decimal(sabit.rate_ngn));

    // Lock the other party's funds (the one who clicked "buy")
    if (sabit.type === SabitType.SELL) {
      // req.user!.id is the buyer, they are paying NGN. Lock their NGN.
      await walletService.lock({
        queryRunner: qr,
        userId: req.user!.id,
        currency: Currency.NGN,
        amount: totalNgn.toFixed(2),
        type: LedgerType.escrow_hold,
        initiatedBy: req.user!.id,
      });
    } else {
      // req.user!.id is the seller, they are giving foreign currency. Lock their foreign currency.
      await walletService.lock({
        queryRunner: qr,
        userId: req.user!.id,
        currency: sabit.currency,
        amount: input.amount,
        type: LedgerType.escrow_hold,
        initiatedBy: req.user!.id,
      });
    }

    const newAvailableAmount = new Decimal(sabit.available_amount).minus(amount);
    // Mark sabit completed when fully consumed so it no longer appears on the marketplace
    const newSabitStatus = newAvailableAmount.lte(0) ? SabitStatus.completed : SabitStatus.active;
    await qr.query(
      `UPDATE "sabits" SET "available_amount" = $1, "status" = $2 WHERE "id" = $3`,
      [newAvailableAmount.toFixed(2), newSabitStatus, sabit.id],
    );

    const reference = await nextReference(qr, 'TXN');

    // Both parties' funds are locked at this point:
    //   SELL sabit — seller's FC locked at sabit creation, buyer's NGN locked above
    //   BUY  sabit — buyer's NGN locked at sabit creation, seller's FC locked above
    // Status is immediately 'escrowed' — no separate confirm step needed.
    const tradeRows = (await qr.query(
      `INSERT INTO "trades" ("id","sabit_id","buyer_id","seller_id","currency","amount","rate_ngn","total_ngn","reference","status","buyer_pin_verified","pin_expires_at","seller_notified_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'escrowed', true, NOW() + INTERVAL '30 minutes', NOW())
       RETURNING *`,
      [sabit.id, buyerId, sellerId, sabit.currency, input.amount, sabit.rate_ngn, totalNgn.toFixed(2), reference],
    )) as Trade[];

    const notificationService = new NotificationService();
    const trade = tradeRows[0];
    
    // Notify both buyer and seller
    await notificationService.createNotification({
        queryRunner: qr,
        userId: trade.buyer_id,
        title: 'Trade Initiated',
        message: `A trade for ${trade.amount} ${trade.currency} has been initiated.`,
        type: NotificationType.info,
        relatedId: trade.id,
    });
    await notificationService.createNotification({
        queryRunner: qr,
        userId: trade.seller_id,
        title: 'New Trade Request',
        message: `A buyer wants to trade ${trade.amount} ${trade.currency} at ₦${trade.rate_ngn}. You have 30 minutes to confirm.`,
        type: NotificationType.info,
        relatedId: trade.id,
    });

    const sellerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [trade.seller_id]);
    if (sellerRows.length > 0) {
      await sendEmail({
        to: sellerRows[0].email,
        subject: 'Action Required — New Trade Request',
        template: 'trade-initiated-seller',
        context: {
          reference: trade.reference,
          currency: trade.currency,
          amount: trade.amount,
          rate_ngn: trade.rate_ngn
        }
      });
    }

    return trade;
  });

  return created(res, { trade });
}

/**
 * @swagger
 * /trades/{id}/seller-confirm:
 *   put:
 *     summary: Seller confirms trade with PIN within 10 minutes
 *     tags: [Trades]
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
 *             required: [pin]
 *             properties:
 *               pin: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: Trade confirmed by seller
 */
export async function sellerConfirmTrade(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);
  const { pin } = sellerConfirmSchema.parse(req.body);

  await withTransaction(async (qr) => {
    const tradeRows = (await qr.query(
      `SELECT * FROM "trades" WHERE "id" = $1 FOR UPDATE`,
      [id],
    )) as Trade[];
    const trade = tradeRows[0];

    if (!trade) throw new NotFoundError('No trade exists with that ID.', 'TRADE_NOT_FOUND');
    if (trade.seller_id !== req.user!.id)
      throw new ForbiddenError('Only the seller assigned to this trade can confirm it.', 'NOT_TRADE_SELLER');
    
    if (trade.status !== TradeStatus.escrowed) {
      throw new AppError(
        'INVALID_TRADE_STATE',
        'This trade is not in escrow and cannot be confirmed.',
        400,
      );
    }

    if (trade.pin_expires_at && new Date() > trade.pin_expires_at) {
      await qr.query(`UPDATE "trades" SET "status" = $1 WHERE "id" = $2`, [TradeStatus.cancelled, id]);

      const walletService = new WalletService();

      // Single sabit query — restore available_amount and unlock the initiating party's funds
      const sabitRows = (await qr.query(
        `SELECT * FROM "sabits" WHERE "id" = $1 FOR UPDATE`,
        [trade.sabit_id],
      )) as Sabit[];

      if (sabitRows.length > 0) {
        const sabit = sabitRows[0];
        const restoredAmount = new Decimal(sabit.available_amount).plus(new Decimal(trade.amount));
        // If the sabit was marked completed when this trade was taken, reopen it
        const restoredStatus = sabit.status === SabitStatus.completed ? SabitStatus.active : sabit.status;
        await qr.query(
          `UPDATE "sabits" SET "available_amount" = $1, "status" = $2 WHERE "id" = $3`,
          [restoredAmount.toFixed(2), restoredStatus, sabit.id],
        );

        // Unlock only the funds locked during initiateTrade (the sabit creator's funds stay locked)
        const whoLockedId   = sabit.type === SabitType.SELL ? trade.buyer_id    : trade.seller_id;
        const unlockCurrency = sabit.type === SabitType.SELL ? Currency.NGN      : trade.currency as Currency;
        const unlockAmount  = sabit.type === SabitType.SELL ? trade.total_ngn   : trade.amount;

        await walletService.unlock({
          queryRunner: qr,
          userId: whoLockedId,
          currency: unlockCurrency,
          amount: unlockAmount,
          type: LedgerType.escrow_release,
          initiatedBy: 'system',
          reference: `${trade.reference}-UL`,
        });
      }

      const buyerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [trade.buyer_id]);
      if (buyerRows.length > 0) {
        await sendEmail({
          to: buyerRows[0].email,
          subject: 'Trade Cancelled — Confirmation Window Expired',
          template: 'pin-expired-cancellation',
          context: { reference: trade.reference },
        });
      }

      const sellerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [trade.seller_id]);
      if (sellerRows.length > 0) {
        await sendEmail({
          to: sellerRows[0].email,
          subject: 'Trade Cancelled — Confirmation Window Expired',
          template: 'pin-expired-cancellation',
          context: { reference: trade.reference },
        });
      }

      throw new AppError('PIN_EXPIRED', 'The 30-minute confirmation window has expired. This trade has been cancelled.', 400);
    }

    const pinValid = await verifyPin(trade.seller_id, pin, qr);
    if (!pinValid) {
      throw new AppError('INVALID_PIN', 'The transaction PIN you entered is incorrect.', 401);
    }

    const walletService = new WalletService();
    
    // PERFORM SETTLEMENT
    // 1. Transfer locked NGN from buyer to seller
    await walletService.transferFromLocked({
      queryRunner: qr,
      fromUserId: trade.buyer_id,
      toUserId: trade.seller_id,
      currency: Currency.NGN,
      amount: trade.total_ngn,
      type: LedgerType.trade_credit,
      initiatedBy: req.user!.id,
      relatedId: trade.id,
      reference: `${trade.reference}-NGN`,
    });

    // 2. Transfer locked foreign currency from seller to buyer
    await walletService.transferFromLocked({
      queryRunner: qr,
      fromUserId: trade.seller_id,
      toUserId: trade.buyer_id,
      currency: trade.currency,
      amount: trade.amount,
      type: LedgerType.trade_credit,
      initiatedBy: req.user!.id,
      relatedId: trade.id,
      reference: `${trade.reference}-FC`,
    });

    await qr.query(`UPDATE "trades" SET "seller_pin_verified" = true, "status" = $1, "completed_at" = NOW() WHERE "id" = $2`, [TradeStatus.completed, id]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: trade.buyer_id,
      title: 'Trade Completed',
      message: 'The seller has confirmed the trade. Funds have been settled to your wallet.',
      type: NotificationType.success,
      relatedId: trade.id,
    });

    await notificationService.createNotification({
      queryRunner: qr,
      userId: trade.seller_id,
      title: 'Trade Completed',
      message: 'You have successfully confirmed and completed the trade.',
      type: NotificationType.success,
      relatedId: trade.id,
    });
  });

  return ok(res, { message: 'Trade confirmed and settled successfully' });
}

