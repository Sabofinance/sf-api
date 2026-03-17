import type { Request, Response } from 'express';
import { z } from 'zod';

import { withTransaction } from '../../database/transaction';
import { ok } from '../../utils/apiResponse';
import { DepositStatus, LedgerType } from '../../utils/enums';
import { AppError, NotFoundError } from '../../utils/errors';
import { WalletService } from '../../services/walletService';

const idSchema = z.object({ id: z.string().uuid() });

/**
 * @swagger
 * /admin/deposits/{id}/approve:
 *   post:
 *     summary: Approve a manual foreign deposit and credit wallet
 *     tags: [Admin]
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
export async function approveDeposit(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);

  const walletService = new WalletService();
  const deposit = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1 FOR UPDATE`, [id])) as Array<any>;
    const dep = rows[0];
    if (!dep) throw new NotFoundError('Deposit not found');

    if (dep.status === DepositStatus.completed) return dep;
    if (dep.status !== DepositStatus.pending_review) {
      throw new AppError('INVALID_STATUS', 'Deposit is not pending review', 400);
    }

    await walletService.credit({
      queryRunner: qr,
      userId: dep.user_id,
      currency: dep.currency,
      amount: dep.amount,
      type: LedgerType.deposit,
      initiatedBy: req.user!.id,
      relatedId: dep.id,
      reference: dep.reference,
    });

    await qr.query(`UPDATE "deposits" SET "status" = $1, "reviewed_by" = $2 WHERE "id" = $3`, [
      DepositStatus.completed,
      req.user!.id,
      dep.id,
    ]);

    const updated = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1`, [dep.id])) as Array<any>;
    return updated[0];
  });

  return ok(res, { deposit });
}

/**
 * @swagger
 * /admin/deposits/{id}/reject:
 *   post:
 *     summary: Reject a manual foreign deposit
 *     tags: [Admin]
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
export async function rejectDeposit(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);
  const deposit = await withTransaction(async (qr) => {
    const rows = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1 FOR UPDATE`, [id])) as Array<any>;
    const dep = rows[0];
    if (!dep) throw new NotFoundError('Deposit not found');

    if (dep.status === DepositStatus.completed) {
      throw new AppError('INVALID_STATUS', 'Cannot reject a completed deposit', 400);
    }

    await qr.query(`UPDATE "deposits" SET "status" = $1, "reviewed_by" = $2 WHERE "id" = $3`, [
      DepositStatus.rejected,
      req.user!.id,
      dep.id,
    ]);
    const updated = (await qr.query(`SELECT * FROM "deposits" WHERE "id" = $1 LIMIT 1`, [dep.id])) as Array<any>;
    return updated[0];
  });

  return ok(res, { deposit });
}

