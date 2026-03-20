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

export async function markRead(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);

  await withTransaction(async (qr) => {
    const result = await qr.query(
      `UPDATE "notifications" SET "status" = $1 WHERE "id" = $2 AND ("user_id" = $3 OR $4 = 'admin')`,
      [NotificationStatus.read, id, req.user!.id, req.user!.role]
    );

    if (result[1] === 0) {
      throw new NotFoundError('Notification not found or access denied');
    }
  });

  return ok(res, { message: 'Notification marked as read' });
}

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