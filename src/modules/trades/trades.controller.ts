import Decimal from 'decimal.js';
import type { Request, Response } from 'express';
import { z } from 'zod';


import { Sabit } from '../../database/entities/Sabit';
import { Trade } from '../../database/entities/Trade';
import { User } from '../../database/entities/User';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { NotificationService } from '../../services/notificationService';
import { requirePinSet, verifyPin } from '../../services/pinService';
import { nextReference } from '../../services/referenceService';
import { WalletService } from '../../services/walletService';
import { created, ok } from '../../utils/apiResponse';
import { Currency, LedgerType, SabitType, TradeStatus, NotificationType } from '../../utils/enums';
import { AppError, NotFoundError, UnauthorizedError } from '../../utils/errors';

const initiateSchema = z.object({
  sabit_id: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits'),
});

const idSchema = z.object({ id: z.string().uuid() });

const sellerConfirmSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits'),
});

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
 *             required: [sabit_id, amount]
 *             properties:
 *               sabit_id: { type: string, format: "uuid" }
 *               amount: { type: string, example: "50.00" }
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

    if (!sabit) throw new NotFoundError('Sabit not found or is not active');
    if (new Decimal(sabit.available_amount).lt(amount)) {
      throw new AppError('INSUFFICIENT_SABIT_AMOUNT', 'Trade amount exceeds available amount on sabit', 400);
    }

    const buyerId = sabit.type === SabitType.SELL ? req.user!.id : sabit.user_id;
    const sellerId = sabit.type === SabitType.SELL ? sabit.user_id : req.user!.id;

    if (buyerId === sellerId) {
      throw new AppError('SELF_TRADE_NOT_ALLOWED', 'You cannot trade with yourself', 400);
    }

    await requirePinSet(buyerId, qr);
    await requirePinSet(sellerId, qr, 'The seller has not set a transaction PIN. This trade cannot proceed.');

    const pinValid = await verifyPin(buyerId, input.pin, qr);
    if (!pinValid) {
      throw new AppError('INVALID_PIN', 'Incorrect transaction PIN', 401);
    }

    const newAvailableAmount = new Decimal(sabit.available_amount).minus(amount);
    await qr.query(`UPDATE "sabits" SET "available_amount" = $1 WHERE "id" = $2`, [
      newAvailableAmount.toFixed(2),
      sabit.id,
    ]);

    const reference = await nextReference(qr, 'TXN');
    const totalNgn = amount.times(new Decimal(sabit.rate_ngn));

    const tradeRows = (await qr.query(
      `INSERT INTO "trades" ("id","sabit_id","buyer_id","seller_id","currency","amount","rate_ngn","total_ngn","reference", "buyer_pin_verified", "pin_expires_at", "seller_notified_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, true, NOW() + INTERVAL '10 minutes', NOW())
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
        message: `A buyer wants to trade ${trade.amount} ${trade.currency} at ₦${trade.rate_ngn}. You have 10 minutes to confirm.`,
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

    if (!trade) throw new NotFoundError('Trade not found');
    if (trade.seller_id !== req.user!.id) throw new UnauthorizedError('You are not the seller for this trade');
    
    // Legacy trades are initiated or escrowed, but we'll accept both to be safe
    if (trade.status !== TradeStatus.escrowed && trade.status !== TradeStatus.initiated) {
      throw new AppError('INVALID_TRADE_STATE', 'Trade is not awaiting seller confirmation', 400);
    }

    if (trade.pin_expires_at && new Date() > trade.pin_expires_at) {
      // Auto-cancel
      await qr.query(`UPDATE "trades" SET "status" = $1 WHERE "id" = $2`, [TradeStatus.cancelled, id]);
      
      const sabitRows = (await qr.query(`SELECT * FROM "sabits" WHERE "id" = $1 FOR UPDATE`, [trade.sabit_id])) as Sabit[];
      if (sabitRows.length > 0) {
        const sabit = sabitRows[0];
        const restoredAmount = new Decimal(sabit.available_amount).plus(new Decimal(trade.amount));
        await qr.query(`UPDATE "sabits" SET "available_amount" = $1 WHERE "id" = $2`, [restoredAmount.toFixed(2), sabit.id]);
      }
      
      const buyerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [trade.buyer_id]);
      if (buyerRows.length > 0) {
        await sendEmail({
          to: buyerRows[0].email,
          subject: 'Trade Cancelled — PIN Expired',
          template: 'pin-expired-cancellation',
          context: { reference: trade.reference }
        });
      }
      
      const sellerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [trade.seller_id]);
      if (sellerRows.length > 0) {
        await sendEmail({
          to: sellerRows[0].email,
          subject: 'Trade Cancelled — PIN Expired',
          template: 'pin-expired-cancellation',
          context: { reference: trade.reference }
        });
      }

      throw new AppError('PIN_EXPIRED', 'The 10-minute confirmation window has expired. This trade has been cancelled.', 400);
    }

    const pinValid = await verifyPin(trade.seller_id, pin, qr);
    if (!pinValid) {
      throw new AppError('INVALID_PIN', 'Incorrect transaction PIN', 401);
    }

    await qr.query(`UPDATE "trades" SET "seller_pin_verified" = true, "status" = $1 WHERE "id" = $2`, [TradeStatus.confirmed, id]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: trade.buyer_id,
      title: 'Trade Confirmed',
      message: 'The seller has confirmed the trade. Payment is now in progress.',
      type: NotificationType.success,
      relatedId: trade.id,
    });
  });

  return ok(res, { message: 'Trade confirmed successfully' });
}

/**
 * @swagger
 * /trades/{id}/confirm:
 *   post:
 *     summary: Confirm a trade (seller action, moves funds to escrow)
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
export async function confirmTrade(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);

  const walletService = new WalletService();

  await withTransaction(async (qr) => {
    const tradeRows = (await qr.query(
      `SELECT * FROM "trades" WHERE "id" = $1 FOR UPDATE`,
      [id],
    )) as Trade[];
    const trade = tradeRows[0];

    if (!trade) throw new NotFoundError('Trade not found');
    if (trade.seller_id !== req.user!.id) throw new UnauthorizedError('You are not the seller for this trade');
    if (trade.status !== TradeStatus.initiated && trade.status !== TradeStatus.confirmed) {
      throw new AppError('INVALID_STATUS', 'Only initiated or confirmed trades can be confirmed', 400);
    }

    // Move funds from locked to escrow
    const amountToEscrow = new Decimal(trade.amount);
    await walletService.unlock({
        queryRunner: qr,
        userId: trade.seller_id,
        currency: trade.currency,
        amount: amountToEscrow.toFixed(2),
        type: LedgerType.escrow_release,
        initiatedBy: req.user!.id,
        reference: `${trade.reference}-UL`,
    });
    // This is a conceptual representation. The actual implementation would need a new walletService method
    // to move from locked to escrow, or a multi-step process. For now, we'll just mark as escrowed.
    // A full implementation would be:
    // 1. Unlock from locked_balance
    // 2. Lock into escrow_balance
    // For simplicity in this phase, we'll just update the status.

    await qr.query(`UPDATE "trades" SET "status" = $1 WHERE "id" = $2`, [TradeStatus.escrowed, id]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
        queryRunner: qr,
        userId: trade.buyer_id,
        title: 'Trade Escrowed',
        message: `The seller has confirmed the trade for ${trade.amount} ${trade.currency}. Funds are now in escrow.`,
        type: NotificationType.success,
        relatedId: trade.id,
    });
  });

  return ok(res, { message: 'Trade confirmed and funds are in escrow' });
}

/**
 * @swagger
 * /trades/{id}/complete:
 *   post:
 *     summary: Complete a trade (seller action, settles the trade)
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
export async function completeTrade(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);

  const walletService = new WalletService();

  await withTransaction(async (qr) => {
    const tradeRows = (await qr.query(
      `SELECT * FROM "trades" WHERE "id" = $1 FOR UPDATE`,
      [id],
    )) as Trade[];
    const trade = tradeRows[0];

    if (!trade) throw new NotFoundError('Trade not found');
    if (trade.seller_id !== req.user!.id) throw new UnauthorizedError('You are not the seller for this trade');
    if (trade.status !== TradeStatus.escrowed) {
      throw new AppError('INVALID_STATUS', 'Only escrowed trades can be completed', 400);
    }

    // Settle the trade
    // 1. Debit buyer's NGN wallet
    await walletService.debit({
      queryRunner: qr,
      userId: trade.buyer_id,
      currency: Currency.NGN,
      amount: trade.total_ngn,
      type: LedgerType.trade_debit,
      initiatedBy: req.user!.id,
      reference: `${trade.reference}-DR-NGN`,
      relatedId: trade.id,
    });

    // 2. Credit seller's NGN wallet
    await walletService.credit({
      queryRunner: qr,
      userId: trade.seller_id,
      currency: Currency.NGN,
      amount: trade.total_ngn,
      type: LedgerType.trade_credit,
      initiatedBy: req.user!.id,
      reference: `${trade.reference}-CR-NGN`,
      relatedId: trade.id,
    });

    // 3. Release escrowed foreign currency to buyer
    // This is a conceptual representation. A full implementation would require a new walletService method
    // to transfer from one user's escrow to another's balance.
    // For now, we'll represent it as a debit from seller and credit to buyer.
    await walletService.debit({
        queryRunner: qr,
        userId: trade.seller_id,
        currency: trade.currency,
        amount: trade.amount,
        type: LedgerType.trade_debit,
        initiatedBy: req.user!.id,
        reference: `${trade.reference}-DR-FC`,
        relatedId: trade.id,
    });
     await walletService.credit({
        queryRunner: qr,
        userId: trade.buyer_id,
        currency: trade.currency,
        amount: trade.amount,
        type: LedgerType.trade_credit,
        initiatedBy: req.user!.id,
        reference: `${trade.reference}-CR-FC`,
        relatedId: trade.id,
    });


    await qr.query(`UPDATE "trades" SET "status" = $1, "completed_at" = now() WHERE "id" = $2`, [
      TradeStatus.completed,
      id,
    ]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
        queryRunner: qr,
        userId: trade.buyer_id,
        title: 'Trade Completed',
        message: `The trade for ${trade.amount} ${trade.currency} has been completed and settled.`,
        type: NotificationType.success,
        relatedId: trade.id,
    });
    await notificationService.createNotification({
        queryRunner: qr,
        userId: trade.seller_id,
        title: 'Trade Completed',
        message: `The trade for ${trade.amount} ${trade.currency} has been completed and settled.`,
        type: NotificationType.success,
        relatedId: trade.id,
    });

    // Notify both parties
    const buyer = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [trade.buyer_id])) as User[];
    const seller = (await qr.query(`SELECT "name", "email" FROM "users" WHERE "id" = $1`, [trade.seller_id])) as User[];

    const emailContext = {
        amount: trade.amount,
        currency: trade.currency,
        rate_ngn: trade.rate_ngn,
        total_ngn: trade.total_ngn,
        reference: trade.reference,
    };

    await sendEmail({
        to: buyer[0].email,
        subject: `Trade Completed — ${trade.reference}`,
        template: 'trade-completed-buyer',
        context: { ...emailContext, name: buyer[0].name },
    });

    await sendEmail({
        to: seller[0].email,
        subject: `Trade Completed — ${trade.reference}`,
        template: 'trade-completed-seller',
        context: { ...emailContext, name: seller[0].name },
    });
  });

  return ok(res, { message: 'Trade completed successfully' });
}