/**
 * Synthetic security-event telemetry for local / staging dashboards.
 *
 * Era cut: 2025-01-01
 *   pre_jan_2025  — noisy, weakly classified signals (before architecture work)
 *   post_jan_2025 — structured webhook / IAM / lockout taxonomy (after)
 *
 * Rows are tagged:
 *   details.synthetic = true
 *   details.source = "seed_security_demo"
 *   details.era = "pre_jan_2025" | "post_jan_2025"
 *
 * Idempotent: deletes previous seed rows (same source tag) then re-inserts.
 *
 * Usage:
 *   npm run seed:security
 */

import 'reflect-metadata';

import { AppDataSource } from './data-source';

const SOURCE = 'seed_security_demo';
const TOTAL_EVENTS = 4200;
const PRE_SHARE = 0.4;
const START = new Date('2023-06-01T00:00:00.000Z');
const ERA_CUT = new Date('2025-01-01T00:00:00.000Z');

class Prng {
  private s: number;
  constructor(seed = 77) {
    this.s = seed;
  }

  next(): number {
    this.s = (Math.imul(1664525, this.s) + 1013904223) | 0;
    return (this.s >>> 0) / 0x100000000;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** Uniform date in [start, end). */
  uniformDate(start: Date, end: Date): Date {
    const t = this.next();
    return new Date(start.getTime() + t * (end.getTime() - start.getTime()));
  }
}

type CatalogRow = {
  event_type: string;
  weight: number;
  severities: string[];
  paths: string[];
};

/** Pre-architecture: mostly undifferentiated auth noise, little structured detection. */
const PRE_CATALOG: CatalogRow[] = [
  {
    event_type: 'auth_failed',
    weight: 55,
    severities: ['LOW', 'LOW', 'LOW', 'MEDIUM'],
    paths: ['/auth/login', '/admin/auth/login'],
  },
  {
    event_type: 'invalid_token',
    weight: 18,
    severities: ['LOW', 'MEDIUM'],
    paths: ['/wallets', '/auth/me'],
  },
  {
    event_type: 'expired_token',
    weight: 15,
    severities: ['LOW'],
    paths: ['/wallets', '/trades'],
  },
  {
    event_type: 'invalid_otp',
    weight: 8,
    severities: ['LOW', 'MEDIUM'],
    paths: ['/auth/verify-otp'],
  },
  {
    event_type: 'forbidden',
    weight: 3,
    severities: ['MEDIUM'],
    paths: ['/admin/kyc'],
  },
  {
    event_type: 'webhook_invalid_signature',
    weight: 1,
    severities: ['HIGH'],
    paths: ['/webhooks/flutterwave'],
  },
];

/** Post-architecture: structured detection surface (IAM, webhooks, lockout, rate limits). */
const POST_CATALOG: CatalogRow[] = [
  {
    event_type: 'auth_failed',
    weight: 28,
    severities: ['LOW', 'LOW', 'MEDIUM'],
    paths: ['/auth/login', '/admin/auth/login'],
  },
  {
    event_type: 'invalid_token',
    weight: 10,
    severities: ['LOW', 'MEDIUM'],
    paths: ['/wallets', '/admin/users', '/auth/me'],
  },
  {
    event_type: 'expired_token',
    weight: 8,
    severities: ['LOW'],
    paths: ['/wallets', '/trades', '/admin/dashboard'],
  },
  {
    event_type: 'rate_limited',
    weight: 12,
    severities: ['MEDIUM', 'HIGH'],
    paths: ['/auth/login', '/auth/forgot-password', '/admin/auth/login'],
  },
  {
    event_type: 'invalid_otp',
    weight: 6,
    severities: ['LOW', 'MEDIUM'],
    paths: ['/auth/verify-otp', '/admin/auth/verify-otp'],
  },
  {
    event_type: 'otp_rate_limited',
    weight: 5,
    severities: ['MEDIUM'],
    paths: ['/auth/resend-otp', '/admin/auth/resend-otp'],
  },
  {
    event_type: 'account_locked',
    weight: 6,
    severities: ['HIGH'],
    paths: ['/auth/login'],
  },
  {
    event_type: 'webhook_invalid_signature',
    weight: 10,
    severities: ['HIGH', 'CRITICAL'],
    paths: ['/webhooks/flutterwave'],
  },
  {
    event_type: 'webhook_replay',
    weight: 4,
    severities: ['HIGH'],
    paths: ['/webhooks/flutterwave'],
  },
  {
    event_type: 'webhook_malformed',
    weight: 3,
    severities: ['MEDIUM', 'HIGH'],
    paths: ['/webhooks/flutterwave'],
  },
  {
    event_type: 'permission_denied',
    weight: 5,
    severities: ['MEDIUM', 'HIGH'],
    paths: ['/admin/security/threat-metrics', '/admin/admins', '/admin/invites'],
  },
  {
    event_type: 'unauthorized_admin',
    weight: 2,
    severities: ['HIGH'],
    paths: ['/admin/users', '/admin/security/events'],
  },
  {
    event_type: 'forbidden',
    weight: 1,
    severities: ['MEDIUM'],
    paths: ['/admin/kyc'],
  },
];

function weightSum(catalog: CatalogRow[]): number {
  return catalog.reduce((s, r) => s + r.weight, 0);
}

function pickType(rng: Prng, catalog: CatalogRow[]): CatalogRow {
  let roll = rng.next() * weightSum(catalog);
  for (const row of catalog) {
    roll -= row.weight;
    if (roll <= 0) return row;
  }
  return catalog[0];
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  'okhttp/4.12.0',
  'SaboFinanceApp/1.4.2 (iOS 17.5)',
];

function demoIp(rng: Prng): string {
  const nets = [
    () => `192.0.2.${rng.int(1, 254)}`,
    () => `198.51.100.${rng.int(1, 254)}`,
    () => `203.0.113.${rng.int(1, 254)}`,
    () => `10.${rng.int(0, 3)}.${rng.int(0, 255)}.${rng.int(1, 254)}`,
  ];
  return rng.pick(nets)();
}

async function seedSecurityDemo() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Sabo Finance — Synthetic security events (era-aware)');
  console.log('══════════════════════════════════════════════════════\n');

  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();

  try {
    await qr.query(`DELETE FROM "security_events" WHERE "details"->>'source' = $1`, [SOURCE]);
    console.log('  Removed previous demo rows (source tag).');

    const rng = new Prng(20230601);
    const end = new Date();
    const preCount = Math.round(TOTAL_EVENTS * PRE_SHARE);
    const postCount = TOTAL_EVENTS - preCount;
    const rows: unknown[][] = [];

    const push = (era: 'pre_jan_2025' | 'post_jan_2025', catalog: CatalogRow[], createdAt: Date) => {
      const spec = pickType(rng, catalog);
      rows.push([
        spec.event_type,
        rng.pick(spec.severities),
        demoIp(rng),
        rng.pick(USER_AGENTS),
        rng.pick(spec.paths),
        JSON.stringify({
          synthetic: true,
          source: SOURCE,
          era,
          note: 'Demo telemetry for admin dashboards. Not organic production attacks.',
        }),
        createdAt.toISOString(),
      ]);
    };

    for (let i = 0; i < preCount; i++) {
      push('pre_jan_2025', PRE_CATALOG, rng.uniformDate(START, ERA_CUT));
    }
    // Uniform across post-era so adjacent 30d windows stay comparable (no fake spike).
    for (let i = 0; i < postCount; i++) {
      push('post_jan_2025', POST_CATALOG, rng.uniformDate(ERA_CUT, end));
    }

    const chunkSize = 400;
    const colCount = 7;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const placeholders = chunk
        .map((_, ri) => {
          const b = ri * colCount;
          return `(gen_random_uuid(), $${b + 1}, $${b + 2}, NULL, $${b + 3}::inet, $${b + 4}, $${b + 5}, $${b + 6}::jsonb, $${b + 7}::timestamptz)`;
        })
        .join(', ');
      await qr.query(
        `INSERT INTO "security_events"
          ("id","event_type","severity","user_id","ip_address","user_agent","path","details","created_at")
         VALUES ${placeholders}`,
        chunk.flat(),
      );
      console.log(`  inserted ${Math.min(i + chunkSize, rows.length)} / ${rows.length}`);
    }

    const summary = (await qr.query(
      `SELECT
         COUNT(*) FILTER (WHERE "details"->>'era' = 'pre_jan_2025')::int AS pre_n,
         COUNT(*) FILTER (WHERE "details"->>'era' = 'post_jan_2025')::int AS post_n,
         MIN("created_at") AS first_at,
         MAX("created_at") AS last_at
       FROM "security_events"
       WHERE "details"->>'source' = $1`,
      [SOURCE],
    )) as Array<{ pre_n: number; post_n: number; first_at: Date; last_at: Date }>;

    console.log('\n  Demo window :', summary[0].first_at, '→', summary[0].last_at);
    console.log(`  Pre-2025    : ${summary[0].pre_n}`);
    console.log(`  Post-2025   : ${summary[0].post_n}`);
    console.log('\n  Filter tip  : baseline_from=2024-07-01Z, current_from=2025-01-01Z, to=now');
    console.log('  These rows are synthetic. Label screenshots accordingly.\n');
  } catch (err) {
    console.error('\n  seed:security failed:', err);
    throw err;
  } finally {
    await qr.release();
    await AppDataSource.destroy();
  }
}

seedSecurityDemo().catch((err) => {
  console.error(err);
  process.exit(1);
});
