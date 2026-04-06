import type { Request, Response } from 'express';
import { z } from 'zod';

import { withTransaction } from '../../database/transaction';
import { ok } from '../../utils/apiResponse';
import { NotificationStatus, UserRole } from '../../utils/enums';
import { NotFoundError, UnauthorizedError } from '../../utils/errors';

const paginationSchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
});

const idSchema = z.object({ id: z.string().uuid() });

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: List notifications
 *     tags: [Notifications]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
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
export async function listNotifications(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { page, limit } = paginationSchema.parse(req.query);

  const notifications = await withTransaction(async (qr) => {
    let query = `SELECT * FROM "notifications"`;
    const params = [];

    if (req.user!.role !== UserRole.admin) {
      query += ` WHERE "user_id" = $1 OR "user_id" IS NULL`;
      params.push(req.user!.id);
    }

    query += ` ORDER BY "created_at" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    return await qr.query(query, params);
  });

  return ok(res, { notifications });
}

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     summary: Mark a notification as read
 *     tags: [Notifications]
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
export async function markRead(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);

  await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `UPDATE "notifications" SET "status" = $1 WHERE "id" = $2 AND ("user_id" = $3 OR $4 = 'admin') RETURNING id`,
      [NotificationStatus.read, id, req.user!.id, req.user!.role],
    )) as Array<{ id: string }>;

    if (rows.length === 0) {
      throw new NotFoundError('No notification with that ID exists on your account.', 'NOTIFICATION_NOT_FOUND');
    }
  });

  return ok(res, { message: 'Notification marked as read' });
}

/**
 * @swagger
 * /notifications/mark-all-read:
 *   post:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function markAllRead(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();

  await withTransaction(async (qr) => {
    await qr.query(
      `UPDATE "notifications" SET "status" = $1 WHERE "user_id" = $2`,
      [NotificationStatus.read, req.user!.id]
    );
  });

  return ok(res, { message: 'All notifications marked as read' });
}