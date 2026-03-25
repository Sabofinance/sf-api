import Decimal from 'decimal.js';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { withTransaction } from '../../database/transaction';
import { WalletService } from '../../services/walletService';
import { ok, created } from '../../utils/apiResponse';
import { Currency, LedgerType } from '../../utils/enums';
import { AppError, UnauthorizedError } from '../../utils/errors';

const quoteSchema = z.object({
  from: z.nativeEnum(Currency),
  to: z.nativeEnum(Currency),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

/**
 * @swagger
 * /conversions/quote:
 *   post:
 *     summary: Get a conversion quote
 *     tags: [Conversions]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from, to, amount]
 *             properties:
 *               from: { $ref: "#/components/schemas/Currency" }
 *               to: { $ref: "#/components/schemas/Currency" }
 *               amount: { type: string, example: "100.00" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getQuote(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { from, to, amount } = quoteSchema.parse(req.body);

  if (from === to) {
    throw new AppError('INVALID_CONVERSION', 'Source and destination currency must be different.', 400);
  }

  // In a real system, this would fetch the live rate and apply a spread
  // For now, we'll use a fixed rate for demonstration
  const rate = new Decimal(1500); // Example: 1 USD = 1500 NGN
  const resultAmount = new Decimal(amount).times(rate);

  const quote = {
    from,
    to,
    amount,
    resultAmount: resultAmount.toFixed(2),
    rate: rate.toFixed(2),
    expiresAt: new Date(Date.now() + 60 * 1000), // Quote valid for 1 minute
  };

  return ok(res, { quote });
}

/**
 * @swagger
 * /conversions/execute:
 *   post:
 *     summary: Execute a conversion
 *     tags: [Conversions]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from, to, amount]
 *             properties:
 *               from: { $ref: "#/components/schemas/Currency" }
 *               to: { $ref: "#/components/schemas/Currency" }
 *               amount: { type: string, example: "100.00" }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function executeQuote(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { from, to, amount } = quoteSchema.parse(req.body);

  if (from === to) {
    throw new AppError('INVALID_CONVERSION', 'Source and destination currency must be different.', 400);
  }

  const walletService = new WalletService();
  const rate = new Decimal(1500); // Example: 1 USD = 1500 NGN
  const resultAmount = new Decimal(amount).times(rate);

  await withTransaction(async (qr) => {
    await walletService.debit({
      queryRunner: qr,
      userId: req.user!.id,
      currency: from,
      amount,
      type: LedgerType.trade_debit,
      initiatedBy: req.user!.id,
    });

    await walletService.credit({
      queryRunner: qr,
      userId: req.user!.id,
      currency: to,
      amount: resultAmount.toFixed(2),
      type: LedgerType.trade_credit,
      initiatedBy: req.user!.id,
    });
  });

  return created(res, { message: 'Conversion successful' });
}