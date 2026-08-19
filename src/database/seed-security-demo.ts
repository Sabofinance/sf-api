/**
 * Synthetic security-event telemetry for local / staging dashboards.
 *
 * This is NOT organic production history. Rows are tagged
 *   details.synthetic = true
 *   details.source = "seed_security_demo"
 * so they can be deleted or filtered. Do not present these numbers to
 * assessors as unaudited live-attack statistics.
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
const START = new Date('2023-06-01T00:00:00.000Z');

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

  /** Bias toward more recent dates (mature system + more traffic later). */
  growthDate(start: Date, end: Date, exponent = 0.55): Date {
    const t = Math.pow(this.next(), exponent);
    return new Date(start.getTime() + t * (end.getTime() - start.getTime()));
  }
}

type CatalogRow = {
  event_type: string;
  weight: number;
  severities: string[];
  paths: string[];
};

const CATALOG: CatalogRow[] = [
  {
    event_type: 'auth_failed',
    weight: 38,
    severities: ['LOW', 'LOW', 'MEDIUM'],
    paths: ['/auth/login', '/admin/auth/login'],
  },
  {
    event_type: 'invalid_token',
    weight: 12,
    severities: ['LOW', 'MEDIUM'],
    paths: ['/wallets', '/admin/users', '/auth/me'],
  },
  {
    event_type: 'expired_token',
    weight: 10,
    severities: ['LOW'],
    paths: ['/wallets', '/trades', '/admin/dashboard'],
  },
  {
    event_type: 'rate_limited',
    weight: 10,
    severities: ['MEDIUM', 'HIGH'],
    paths: ['/auth/login', '/auth/forgot-password', '/admin/auth/login'],
  },
  {
    event_type: 'invalid_otp',
    weight: 8,
    severities: ['LOW', 'MEDIUM'],
    paths: ['/auth/verify-otp', '/admin/auth/verify-otp'],
  },
  {
    event_type: 'otp_rate_limited',
    weight: 4,
    severities: ['MEDIUM'],
    paths: ['/auth/resend-otp', '/admin/auth/resend-otp'],
  },
  {
    event_type: 'account_locked',
    weight: 4,
    severities: ['HIGH'],
    paths: ['/auth/login'],
  },
  {
    event_type: 'webhook_invalid_signature',
    weight: 5,
    severities: ['HIGH', 'CRITICAL'],
    paths: ['/webhooks/flutterwave'],
  },
  {
    event_type: 'webhook_replay',
    weight: 2,
    severities: ['HIGH'],
    paths: ['/webhooks/flutterwave'],
  },
  {
    event_type: 'webhook_malformed',
    weight: 2,
    severities: ['MEDIUM', 'HIGH'],
    paths: ['/webhooks/flutterwave'],
  },
  {
    event_type: 'permission_denied',
    weight: 3,
    severities: ['MEDIUM', 'HIGH'],
    paths: ['/admin/security/threat-metrics', '/admin/admins', '/admin/invites'],
  },
  {
    event_type: 'unauthorized_admin',
    weight: 1,
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

const WEIGHT_SUM = CATALOG.reduce((s, r) => s + r.weight, 0);

function pickType(rng: Prng): CatalogRow {
  let roll = rng.next() * WEIGHT_SUM;
  for (const row of CATALOG) {
    roll -= row.weight;
    if (roll <= 0) return row;
  }
  return CATALOG[0];
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
  console.log('  Sabo Finance — Synthetic security events (demo)');
  console.log('══════════════════════════════════════════════════════\n');

  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();

  try {
    const deleted = (await qr.query(
      `DELETE FROM "security_events" WHERE "details"->>'source' = $1`,
      [SOURCE],
    )) as unknown;
    console.log('  Removed previous demo rows (source tag).');
    void deleted;

    const rng = new Prng(20230601);
    const end = new Date();
    const rows: unknown[][] = [];

    for (let i = 0; i < TOTAL_EVENTS; i++) {
      const spec = pickType(rng);
      const createdAt = rng.growthDate(START, end);
      const severity = rng.pick(spec.severities);
      const path = rng.pick(spec.paths);
      const details = JSON.stringify({
        synthetic: true,
        source: SOURCE,
        note: 'Demo telemetry for admin dashboards. Not organic production attacks.',
      });

      rows.push([
        spec.event_type,
        severity,
        demoIp(rng),
        rng.pick(USER_AGENTS),
        path,
        details,
        createdAt.toISOString(),
      ]);
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
    console.log(`  inserted ${rows.length} / ${rows.length}                    `);

    const [summary] = (await qr.query(
      `SELECT COUNT(*)::int AS n,
              MIN("created_at") AS first_at,
              MAX("created_at") AS last_at
       FROM "security_events"
       WHERE "details"->>'source' = $1`,
      [SOURCE],
    )) as Array<{ n: number; first_at: Date; last_at: Date }>;

    console.log('\n  Demo window :', summary.first_at, '→', summary.last_at);
    console.log('  Row count   :', summary.n);
    console.log('\n  Refresh GET /admin/security/threat-metrics as super_admin.');
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
