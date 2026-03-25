import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppDataSource } from '../../database/data-source';
import { Trade } from '../../database/entities/Trade';
import { TradeRating } from '../../database/entities/TradeRating';
import { withTransaction } from '../../database/transaction';
import { created, ok } from '../../utils/apiResponse';
import { TradeStatus } from '../../utils/enums';
import { AppError, ForbiddenError, NotFoundError } from '../../utils/errors';

const submitRatingSchema = z.object({
  trade_id: z.string().uuid(),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

/**
 * @swagger
 * /ratings:
 *   post:
 *     summary: Rate a user after a completed trade
 *     tags: [Ratings]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [trade_id, score]
 *             properties:
 *               trade_id: { type: string, format: uuid }
 *               score: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string }
 *     responses:
 *       201:
 *         description: Rating submitted successfully
 */
export async function submitRating(req: Request, res: Response) {
  const { trade_id, score, comment } = submitRatingSchema.parse(req.body);
  const rater_id = req.user!.id;

  const rating = await withTransaction(async (qr) => {
    // 1. Verify trade exists and is completed
    const trades = (await qr.query(`SELECT * FROM "trades" WHERE "id" = $1 LIMIT 1`, [trade_id])) as Trade[];
    const trade = trades[0];
    if (!trade) throw new NotFoundError('Trade not found');

    if (trade.status !== TradeStatus.completed) {
      throw new AppError('INVALID_TRADE', 'Ratings are only available after the trade is marked completed.', 400);
    }

    // 2. Verify rater was part of the trade and determine who they are rating
    let rated_user_id: string;
    if (trade.buyer_id === rater_id) {
      rated_user_id = trade.seller_id;
    } else if (trade.seller_id === rater_id) {
      rated_user_id = trade.buyer_id;
    } else {
      throw new ForbiddenError('Only the buyer or seller in this trade can leave a rating.', 'NOT_TRADE_PARTICIPANT');
    }

    // 3. Ensure they haven't already rated this trade
    const existing = (await qr.query(`SELECT id FROM "trade_ratings" WHERE "trade_id" = $1 AND "rater_id" = $2 LIMIT 1`, [
      trade_id,
      rater_id,
    ])) as TradeRating[];

    if (existing.length > 0) {
      throw new AppError('ALREADY_RATED', 'You have already submitted a rating for this trade.', 400);
    }

    // 4. Insert the rating
    const rows = (await qr.query(
      `INSERT INTO "trade_ratings" ("id", "trade_id", "rater_id", "rated_user_id", "score", "comment", "created_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
       RETURNING *`,
      [trade_id, rater_id, rated_user_id, score, comment || null],
    )) as TradeRating[];

    return rows[0];
  });

  return created(res, { rating });
}

const idSchema = z.object({ id: z.string().uuid() });

/**
 * @swagger
 * /ratings/user/{id}:
 *   get:
 *     summary: Get a user's aggregate reputation score and recent reviews
 *     tags: [Ratings]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 */
export async function getUserReputation(req: Request, res: Response) {
  const { id } = idSchema.parse(req.params);

  // Get aggregate stats
  const statsRows = (await AppDataSource.query(`
    SELECT 
      COUNT(*) as total_reviews,
      ROUND(AVG(score), 2) as average_score
    FROM "trade_ratings"
    WHERE "rated_user_id" = $1
  `, [id])) as Array<{ total_reviews: string; average_score: string | null }>;

  const stats = statsRows[0];

  // Get recent reviews
  const recentReviews = await AppDataSource.query(`
    SELECT r.id, r.score, r.comment, r.created_at, u.name as rater_name
    FROM "trade_ratings" r
    JOIN "users" u ON r.rater_id = u.id
    WHERE r."rated_user_id" = $1 AND r.comment IS NOT NULL
    ORDER BY r.created_at DESC
    LIMIT 10
  `, [id]);

  return ok(res, {
    reputation: {
      average_score: stats.average_score ? parseFloat(stats.average_score) : 0,
      total_reviews: parseInt(stats.total_reviews, 10),
    },
    recent_reviews: recentReviews,
  });
}