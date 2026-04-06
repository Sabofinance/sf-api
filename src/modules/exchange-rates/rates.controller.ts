import type { Request, Response } from 'express';

import { withTransaction } from '../../database/transaction';
import { ok } from '../../utils/apiResponse';

/**
 * @swagger
 * /rates:
 *   get:
 *     summary: Get latest exchange rates with 24h change and P2P market spread
 *     tags: [Exchange Rates]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getRates(_req: Request, res: Response) {
  const rates = await withTransaction(async (qr) => {
    // Latest rate per pair
    const latest = (await qr.query(
      `SELECT DISTINCT ON ("pair") "pair", "rate", "source", "created_at"
       FROM "exchange_rates"
       ORDER BY "pair", "created_at" DESC, "id" DESC`,
    )) as Array<{ pair: string; rate: string; source: string; created_at: string }>;

    // Rate snapshot from ~24h ago per pair (closest record before NOW() - 24h)
    const prev24h = (await qr.query(
      `SELECT DISTINCT ON ("pair") "pair", "rate"
       FROM "exchange_rates"
       WHERE "created_at" <= NOW() - INTERVAL '24 hours'
       ORDER BY "pair", "created_at" DESC`,
    )) as Array<{ pair: string; rate: string }>;

    const prev24hMap = new Map(prev24h.map((r) => [r.pair, r.rate]));

    // Best P2P rates from active sabits (lowest ask = cheapest SELL, highest bid = best BUY)
    const p2pSpreads = (await qr.query(
      `SELECT
         currency,
         MIN(rate_ngn) FILTER (WHERE type = 'sell') AS best_sell_rate,
         MAX(rate_ngn) FILTER (WHERE type = 'buy')  AS best_buy_rate,
         COUNT(*) FILTER (WHERE type = 'sell')      AS active_sell_listings,
         COUNT(*) FILTER (WHERE type = 'buy')       AS active_buy_listings
       FROM "sabits"
       WHERE status = 'active'
       GROUP BY currency`,
    )) as Array<{
      currency: string;
      best_sell_rate: string | null;
      best_buy_rate: string | null;
      active_sell_listings: string;
      active_buy_listings: string;
    }>;

    const spreadMap = new Map(p2pSpreads.map((r) => [r.currency, r]));

    return latest.map((row) => {
      const currency = row.pair.split('/')[0]; // "GBP" from "GBP/NGN"
      const currentRate = parseFloat(row.rate);
      const prevRate = prev24hMap.has(row.pair) ? parseFloat(prev24hMap.get(row.pair)!) : null;
      const change24hPct =
        prevRate !== null && prevRate > 0
          ? parseFloat(((( currentRate - prevRate) / prevRate) * 100).toFixed(4))
          : null;

      const spread = spreadMap.get(currency);

      return {
        pair: row.pair,
        rate: row.rate,
        source: row.source,
        updated_at: row.created_at,
        change_24h_pct: change24hPct,
        p2p: {
          best_sell_rate: spread?.best_sell_rate ?? null,
          best_buy_rate: spread?.best_buy_rate ?? null,
          active_sell_listings: parseInt(spread?.active_sell_listings ?? '0'),
          active_buy_listings: parseInt(spread?.active_buy_listings ?? '0'),
        },
      };
    });
  });

  return ok(res, { rates });
}

/**
 * @swagger
 * /rates/history/{pair}:
 *   get:
 *     summary: Get rate history for a currency pair (last 30 days)
 *     tags: [Exchange Rates]
 *     parameters:
 *       - in: path
 *         name: pair
 *         required: true
 *         schema: { type: string, example: "GBP-NGN" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getRateHistory(_req: Request, res: Response) {
  // Normalise: frontend may pass "GBP-NGN" or "GBP/NGN"
  const raw = (_req.params.pair ?? '').toUpperCase().replace('-', '/');

  const history = await withTransaction(async (qr) => {
    return (await qr.query(
      `SELECT
         DATE_TRUNC('hour', created_at) AS bucket,
         AVG(rate::numeric)::text        AS rate
       FROM "exchange_rates"
       WHERE "pair" = $1
         AND "created_at" >= NOW() - INTERVAL '30 days'
       GROUP BY bucket
       ORDER BY bucket ASC`,
      [raw],
    )) as Array<{ bucket: string; rate: string }>;
  });

  return ok(res, { pair: raw, history });
}
