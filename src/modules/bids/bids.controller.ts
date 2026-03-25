import Decimal from 'decimal.js';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { Bid } from '../../database/entities/Bid';
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
import { BidStatus, Currency, LedgerType, NotificationType, SabitStatus, SabitType, TradeStatus } from '../../utils/enums';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../utils/errors';

const placeBidSchema = z.object({
  sabit_id: z.string().uuid('Invalid listing ID'),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount'),
  proposed_rate_ngn: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid rate'),
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits'),
});

const idSchema = z.object({ id: z.string().uuid() });

const acceptBidSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits'),
});

const rejectBidSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits'),
  reason: z.string().max(500).optional(),
});

/**
 * @swagger
 * /bids:
 *   post:
 *     summary: Place a bid on a SELL sabit
 *     tags: [Bids]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sabit_id, amount, proposed_rate_ngn, pin]
 *             properties:
 *               sabit_id: { type: string, format: uuid }
 *               amount: { type: string, example: "100.00" }
 *               proposed_rate_ngn: { type: string, example: "1500.00" }
 *               pin: { type: string, example: "123456" }
 *     responses:
 *       201:
 *         description: Bid placed
 */
export async function placeBid(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const input = placeBidSchema.parse(req.body);
  const buyerId = req.user.id;

  const bid = await withTransaction(async (qr) => {
    const sabitRows = (await qr.query(`SELECT * FROM "sabits" WHERE "id" = $1 FOR UPDATE`, [
      input.sabit_id,
    ])) as Sabit[];
    const sabit = sabitRows[0];

    if (!sabit || sabit.status !== SabitStatus.active || sabit.type !== SabitType.SELL) {
      throw new AppError('INVALID_LISTING', 'Listing is not available or not a SELL listing', 400);
    }

    if (sabit.user_id === buyerId) {
      throw new AppError('CANNOT_BID_OWN_LISTING', 'You cannot bid on your own listing', 400);
    }

    const proposedRate = new Decimal(input.proposed_rate_ngn);
    const originalRate = new Decimal(sabit.rate_ngn);
    if (proposedRate.gte(originalRate)) {
      throw new AppError('BID_RATE_TOO_HIGH', 'Your bid rate must be lower than the listing rate', 400);
    }

    const amount = new Decimal(input.amount);
    if (amount.gt(new Decimal(sabit.available_amount))) {
      throw new AppError('INSUFFICIENT_LISTING_AMOUNT', 'The requested amount exceeds what is available on this listing', 400);
    }

    const existingBid = await qr.query(
      `SELECT id FROM "bids" WHERE "buyer_id" = $1 AND "sabit_id" = $2 AND "status" = 'pending' LIMIT 1`,
      [buyerId, sabit.id]
    );
    if (existingBid.length > 0) {
      throw new AppError('DUPLICATE_BID', 'You already have a pending bid on this listing', 400);
    }

    await requirePinSet(buyerId, qr);
    const pinValid = await verifyPin(buyerId, input.pin, qr);
    if (!pinValid) {
      throw new AppError('INVALID_PIN', 'The transaction PIN you entered is incorrect.', 401);
    }

    const totalNgnAtBidRate = amount.times(proposedRate).toFixed(2);
    const bidReference = await nextReference(qr, 'BID');

    // Lock buyer's NGN
    const walletService = new WalletService();
    await walletService.lock({
      queryRunner: qr,
      userId: buyerId,
      currency: Currency.NGN,
      amount: totalNgnAtBidRate,
      type: LedgerType.escrow_hold,
      initiatedBy: buyerId,
      reference: bidReference,
      // relatedId will be updated after bid creation
    });

    const bidRows = await qr.query(
      `INSERT INTO "bids" ("id", "reference", "sabit_id", "buyer_id", "seller_id", "currency", "amount", "proposed_rate_ngn", "original_rate_ngn", "total_ngn_at_bid_rate", "status", "buyer_pin_verified", "expires_at", "created_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', true, NOW() + INTERVAL '24 hours', now())
       RETURNING *`,
      [
        bidReference,
        sabit.id,
        buyerId,
        sabit.user_id,
        sabit.currency,
        input.amount,
        input.proposed_rate_ngn,
        sabit.rate_ngn,
        totalNgnAtBidRate,
      ]
    );
    const newBid = bidRows[0];

    // Update the ledger entry with the related_id
    await qr.query(`UPDATE "ledger" SET "related_id" = $1 WHERE "reference" = $2`, [newBid.id, bidReference]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: newBid.seller_id,
      title: 'New Bid Received',
      message: `Someone offered ₦${input.proposed_rate_ngn} for your ${sabit.currency} listing. Tap to review.`,
      type: NotificationType.info,
      relatedId: newBid.id,
    });

    await notificationService.createNotification({
      queryRunner: qr,
      userId: buyerId,
      title: 'Bid Placed',
      message: `Your bid of ₦${input.proposed_rate_ngn} per ${sabit.currency} is pending seller review.`,
      type: NotificationType.info,
      relatedId: newBid.id,
    });

    const sellerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [newBid.seller_id]);
    if (sellerRows.length > 0) {
      await sendEmail({
        to: sellerRows[0].email,
        subject: `New Bid on Your Listing — ${bidReference}`,
        template: 'bid-placed-seller',
        context: {
          reference: bidReference,
          currency: sabit.currency,
          amount: input.amount,
          original_rate_ngn: sabit.rate_ngn,
          proposed_rate_ngn: input.proposed_rate_ngn,
          total_ngn_at_bid_rate: totalNgnAtBidRate,
        },
      });
    }

    const buyerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [buyerId]);
    if (buyerRows.length > 0) {
      await sendEmail({
        to: buyerRows[0].email,
        subject: `Your Bid Has Been Placed — ${bidReference}`,
        template: 'bid-placed-buyer',
        context: {
          reference: bidReference,
          currency: sabit.currency,
          amount: input.amount,
          proposed_rate_ngn: input.proposed_rate_ngn,
          total_ngn_at_bid_rate: totalNgnAtBidRate,
        },
      });
    }

    return newBid;
  });

  return created(res, { bid });
}

/**
 * @swagger
 * /bids/mine:
 *   get:
 *     summary: Get bids placed by the authenticated user
 *     tags: [Bids]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Success
 */
export async function getMyBids(req: Request, res: Response) {
  const status = req.query.status as string;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = (page - 1) * limit;

  let query = `SELECT * FROM "bids" WHERE "buyer_id" = $1`;
  const params: any[] = [req.user!.id];

  if (status) {
    query += ` AND "status" = $2`;
    params.push(status);
  }

  query += ` ORDER BY "created_at" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  
  const bids = await withTransaction(async (qr) => {
    return qr.query(query, [...params, limit, offset]);
  });

  return ok(res, { bids });
}

/**
 * @swagger
 * /bids/received:
 *   get:
 *     summary: Get bids received on your listings
 *     tags: [Bids]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Success
 */
export async function getReceivedBids(req: Request, res: Response) {
  const status = req.query.status as string;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = (page - 1) * limit;

  let query = `SELECT * FROM "bids" WHERE "seller_id" = $1`;
  const params: any[] = [req.user!.id];

  if (status) {
    query += ` AND "status" = $2`;
    params.push(status);
  }

  query += ` ORDER BY "created_at" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  
  const bids = await withTransaction(async (qr) => {
    return qr.query(query, [...params, limit, offset]);
  });

  return ok(res, { bids });
}

/**
 * @swagger
 * /bids/{id}/accept:
 *   put:
 *     summary: Accept a bid (Seller only)
 *     tags: [Bids]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
 *         description: Trade created
 */
export async function acceptBid(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  const { pin } = acceptBidSchema.parse(req.body);

  const trade = await withTransaction(async (qr) => {
    const bidRows = await qr.query(`SELECT * FROM "bids" WHERE "id" = $1 FOR UPDATE`, [id]) as Bid[];
    const bid = bidRows[0];

    if (!bid || bid.status !== BidStatus.pending) {
      throw new AppError('INVALID_BID', 'Bid is not available or already processed', 400);
    }
    if (bid.seller_id !== req.user!.id) {
      throw new ForbiddenError('Only the listing seller can respond to this bid.', 'NOT_BID_SELLER');
    }

    if (new Date() > new Date(bid.expires_at)) {
      await qr.query(`UPDATE "bids" SET "status" = 'expired' WHERE "id" = $1`, [bid.id]);
      const walletService = new WalletService();
      await walletService.unlock({
        queryRunner: qr,
        userId: bid.buyer_id,
        currency: Currency.NGN,
        amount: bid.total_ngn_at_bid_rate,
        type: LedgerType.escrow_release,
        initiatedBy: bid.seller_id,
        reference: `BID-EXP-${bid.reference}`,
      });
      throw new AppError('BID_EXPIRED', 'This bid has expired', 400);
    }

    await requirePinSet(bid.seller_id, qr);
    const pinValid = await verifyPin(bid.seller_id, pin, qr);
    if (!pinValid) {
      throw new AppError('INVALID_PIN', 'The transaction PIN you entered is incorrect.', 401);
    }

    const sabitRows = await qr.query(`SELECT * FROM "sabits" WHERE "id" = $1 FOR UPDATE`, [bid.sabit_id]) as Sabit[];
    const sabit = sabitRows[0];

    const walletService = new WalletService();
    await walletService.lock({
      queryRunner: qr,
      userId: bid.seller_id,
      currency: bid.currency,
      amount: bid.amount,
      type: LedgerType.escrow_hold,
      initiatedBy: bid.seller_id,
      reference: `BID-ACC-${bid.reference}`,
    });

    await qr.query(`UPDATE "bids" SET "status" = 'accepted', "seller_responded_at" = NOW() WHERE "id" = $1`, [bid.id]);

    const newAvailableAmount = new Decimal(sabit.available_amount).minus(new Decimal(bid.amount));
    await qr.query(`UPDATE "sabits" SET "available_amount" = $1 WHERE "id" = $2`, [newAvailableAmount.toFixed(2), sabit.id]);

    const tradeReference = await nextReference(qr, 'TXN');

    const tradeRows = await qr.query(
      `INSERT INTO "trades" ("id", "sabit_id", "buyer_id", "seller_id", "currency", "amount", "rate_ngn", "total_ngn", "reference", "status", "buyer_pin_verified", "seller_pin_verified", "pin_expires_at", "bid_id", "created_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, true, true, NOW() + INTERVAL '10 minutes', $10, now())
       RETURNING *`,
      [
        sabit.id,
        bid.buyer_id,
        bid.seller_id,
        bid.currency,
        bid.amount,
        bid.proposed_rate_ngn,
        bid.total_ngn_at_bid_rate,
        tradeReference,
        TradeStatus.escrowed,
        bid.id,
      ]
    );
    const newTrade = tradeRows[0];

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: bid.buyer_id,
      title: 'Bid Accepted',
      message: `Your bid of ₦${bid.proposed_rate_ngn} per ${bid.currency} has been accepted. Complete your payment now.`,
      type: NotificationType.success,
      relatedId: newTrade.id,
    });
    await notificationService.createNotification({
      queryRunner: qr,
      userId: bid.seller_id,
      title: 'Bid Accepted',
      message: `You accepted the bid. Trade ${tradeReference} is now in progress.`,
      type: NotificationType.success,
      relatedId: newTrade.id,
    });

    const buyerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [bid.buyer_id]);
    if (buyerRows.length > 0) {
      await sendEmail({
        to: buyerRows[0].email,
        subject: `Your Bid Was Accepted — ${bid.reference}`,
        template: 'bid-accepted-buyer',
        context: {
          reference: bid.reference,
          trade_reference: tradeReference,
          proposed_rate_ngn: bid.proposed_rate_ngn,
          amount: bid.amount,
          currency: bid.currency,
        },
      });
    }

    const sellerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [bid.seller_id]);
    if (sellerRows.length > 0) {
      await sendEmail({
        to: sellerRows[0].email,
        subject: `You Accepted a Bid — ${bid.reference}`,
        template: 'bid-accepted-seller',
        context: {
          reference: bid.reference,
          trade_reference: tradeReference,
          proposed_rate_ngn: bid.proposed_rate_ngn,
        },
      });
    }

    return newTrade;
  });

  return ok(res, { trade });
}

/**
 * @swagger
 * /bids/{id}/reject:
 *   put:
 *     summary: Reject a pending bid (Seller only)
 *     tags: [Bids]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pin]
 *             properties:
 *               pin: { type: string, example: "123456" }
 *               reason: { type: string, example: "Rate too low for current market." }
 *     responses:
 *       200:
 *         description: Bid rejected
 */
export async function rejectBid(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  const { pin, reason } = rejectBidSchema.parse(req.body);

  await withTransaction(async (qr) => {
    const bidRows = await qr.query(`SELECT * FROM "bids" WHERE "id" = $1 FOR UPDATE`, [id]) as Bid[];
    const bid = bidRows[0];

    if (!bid || bid.status !== BidStatus.pending) {
      throw new AppError('INVALID_BID', 'Bid is not available or already processed', 400);
    }
    if (bid.seller_id !== req.user!.id) {
      throw new ForbiddenError('Only the listing seller can respond to this bid.', 'NOT_BID_SELLER');
    }

    if (new Date() > new Date(bid.expires_at)) {
      throw new AppError('BID_EXPIRED', 'This bid has expired', 400);
    }

    const pinValid = await verifyPin(bid.seller_id, pin, qr);
    if (!pinValid) {
      throw new AppError('INVALID_PIN', 'The transaction PIN you entered is incorrect.', 401);
    }

    await qr.query(`UPDATE "bids" SET "status" = 'rejected', "seller_responded_at" = NOW(), "rejection_reason" = $2 WHERE "id" = $1`, [bid.id, reason || null]);

    const walletService = new WalletService();
    await walletService.unlock({
      queryRunner: qr,
      userId: bid.buyer_id,
      currency: Currency.NGN,
      amount: bid.total_ngn_at_bid_rate,
      type: LedgerType.escrow_release,
      initiatedBy: bid.seller_id,
      reference: `BID-REJ-${bid.reference}`,
    });

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: bid.buyer_id,
      title: 'Bid Not Accepted',
      message: `The seller declined your bid of ₦${bid.proposed_rate_ngn}. Your funds have been returned.`,
      type: NotificationType.info,
      relatedId: bid.id,
    });

    const buyerRows = await qr.query(`SELECT email FROM users WHERE id = $1`, [bid.buyer_id]);
    if (buyerRows.length > 0) {
      await sendEmail({
        to: buyerRows[0].email,
        subject: `Your Bid Was Not Accepted — ${bid.reference}`,
        template: 'bid-rejected-buyer',
        context: {
          reference: bid.reference,
          proposed_rate_ngn: bid.proposed_rate_ngn,
          rejection_reason: reason || '',
          total_ngn_at_bid_rate: bid.total_ngn_at_bid_rate,
        },
      });
    }
  });

  return ok(res, { message: 'Bid rejected successfully' });
}

/**
 * @swagger
 * /bids/{id}/withdraw:
 *   put:
 *     summary: Withdraw a pending bid (Buyer only)
 *     tags: [Bids]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Bid withdrawn
 */
export async function withdrawBid(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);

  await withTransaction(async (qr) => {
    const bidRows = await qr.query(`SELECT * FROM "bids" WHERE "id" = $1 FOR UPDATE`, [id]) as Bid[];
    const bid = bidRows[0];

    if (!bid || bid.status !== BidStatus.pending) {
      throw new AppError('INVALID_BID', 'Bid is not available or already processed', 400);
    }
    if (bid.buyer_id !== req.user!.id) {
      throw new ForbiddenError('Only the buyer who placed this bid can withdraw it.', 'NOT_BID_BUYER');
    }

    await qr.query(`UPDATE "bids" SET "status" = 'withdrawn' WHERE "id" = $1`, [bid.id]);

    const walletService = new WalletService();
    await walletService.unlock({
      queryRunner: qr,
      userId: bid.buyer_id,
      currency: Currency.NGN,
      amount: bid.total_ngn_at_bid_rate,
      type: LedgerType.escrow_release,
      initiatedBy: bid.buyer_id,
      reference: `BID-WTH-${bid.reference}`,
    });
  });

  return ok(res, { message: 'Bid withdrawn successfully' });
}
