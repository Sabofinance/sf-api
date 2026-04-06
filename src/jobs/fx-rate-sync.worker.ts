import { env } from '../config/env';
import { AppDataSource } from '../database/data-source';

const PAIRS: { pair: string; from: string; to: string }[] = [
  { pair: 'GBP/NGN', from: 'GBP', to: 'NGN' },
  { pair: 'USD/NGN', from: 'USD', to: 'NGN' },
  { pair: 'CAD/NGN', from: 'CAD', to: 'NGN' },
];

/**
 * Fetches latest rates from Open Exchange Rates (USD base) and writes
 * one new row per pair into exchange_rates.
 *
 * Requires FX_API_KEY env var. If absent, the job is a no-op so the
 * app still starts and falls back to the last persisted rates.
 */
export async function syncFxRates(): Promise<void> {
  if (!env.FX_API_KEY) {
    console.warn('[fx-rate-sync] FX_API_KEY not set — skipping rate sync');
    return;
  }

  const url = `https://openexchangerates.org/api/latest.json?app_id=${env.FX_API_KEY}&symbols=GBP,CAD,NGN`;

  let data: { rates: Record<string, number> };
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[fx-rate-sync] HTTP ${res.status} from OpenExchangeRates`);
      return;
    }
    data = (await res.json()) as { rates: Record<string, number> };
  } catch (err) {
    console.error('[fx-rate-sync] Network error fetching rates:', err);
    return;
  }

  const { rates } = data;
  if (!rates?.NGN) {
    console.error('[fx-rate-sync] Unexpected response shape — NGN rate missing');
    return;
  }

  // All rates are relative to USD. Derive cross-rates to NGN.
  const computed: Record<string, number> = {
    'GBP/NGN': rates.NGN / (rates.GBP ?? 1),
    'USD/NGN': rates.NGN,
    'CAD/NGN': rates.NGN / (rates.CAD ?? 1),
  };

  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  try {
    for (const { pair } of PAIRS) {
      const rate = computed[pair];
      if (!rate) continue;
      await qr.query(
        `INSERT INTO "exchange_rates" ("id", "pair", "rate", "source", "created_at")
         VALUES (gen_random_uuid(), $1, $2, 'openexchangerates', NOW())`,
        [pair, rate.toFixed(6)],
      );
    }
    console.log(`[fx-rate-sync] Rates updated at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('[fx-rate-sync] DB write error:', err);
  } finally {
    await qr.release();
  }
}
