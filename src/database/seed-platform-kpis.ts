/**
 * Demo seed for platform KPIs (local / staging only).
 *
 * Era narrative (filterable by date on the portal):
 *   Before (to ≈ 2024-12-31): ~96.8% uptime, ~94% txn success, 0 neutralized, 0 gaps
 *   After  (current 30d):     ~99.2% uptime, ~97% txn success, ~22% detection Δ, 3 neutralized, 9 gaps
 *
 * Do NOT cite as production history. Caption screenshots as demonstration.
 *
 * Usage: npm run migration:run && npm run seed:platform-kpis
 */

import 'reflect-metadata';

import { AppDataSource } from './data-source';
import { computePlatformKpis } from '../services/platformKpi.service';

const SOURCE = 'seed_platform_kpis';
const META = JSON.stringify({ source: SOURCE, synthetic: true, era: 'post_jan_2025' });
const META_PRE = JSON.stringify({ source: SOURCE, synthetic: true, era: 'pre_jan_2025' });
const PRE_TO = new Date('2024-12-31T23:59:59.000Z');
const PRE_CURRENT_FROM = new Date('2024-10-02T00:00:00.000Z');
const PRE_BASELINE_FROM = new Date('2024-07-04T00:00:00.000Z');

const CONTROLS: Array<{
  control_key: string;
  title: string;
  category: string;
  evidence_ref: string;
  closed_at: string;
}> = [
  {
    control_key: 'wallet_single_mutation_path',
    title: 'Single wallet mutation path via WalletService + ledger',
    category: 'integrity',
    evidence_ref: 'src/services/walletService.ts',
    closed_at: '2025-01-20T12:00:00.000Z',
  },
  {
    control_key: 'webhook_timing_safe_hash',
    title: 'Flutterwave verif-hash with timingSafeEqual',
    category: 'webhook',
    evidence_ref: 'src/providers/payments/FlutterwaveProvider.ts',
    closed_at: '2025-01-20T12:00:00.000Z',
  },
  {
    control_key: 'webhook_amount_replay_guard',
    title: 'Amount/currency match + replay guard on deposits',
    category: 'webhook',
    evidence_ref: 'src/modules/deposits/deposits.controller.ts',
    closed_at: '2025-02-10T12:00:00.000Z',
  },
  {
    control_key: 'kyc_money_gate',
    title: 'KYC gate on money-moving routes',
    category: 'access',
    evidence_ref: 'src/middleware/kycMiddleware.ts',
    closed_at: '2025-02-10T12:00:00.000Z',
  },
  {
    control_key: 'admin_permission_matrix',
    title: 'Admin least-privilege permission matrix',
    category: 'iam',
    evidence_ref: 'src/security/permissionMatrix.ts',
    closed_at: '2025-06-14T23:35:00.000Z',
  },
  {
    control_key: 'security_event_pipeline',
    title: 'Security event pipeline + threat APIs',
    category: 'detection',
    evidence_ref: 'src/services/securityEvent.service.ts',
    closed_at: '2025-06-14T23:35:00.000Z',
  },
  {
    control_key: 'anomaly_fx_monitoring',
    title: 'FX / job / API anomaly detection engine',
    category: 'reliability',
    evidence_ref: 'src/services/anomaly-detector.service.ts',
    closed_at: '2025-06-14T23:35:00.000Z',
  },
  {
    control_key: 'login_lockout_rate_limit',
    title: 'Login lockout + auth rate limits + Helmet',
    category: 'iam',
    evidence_ref: 'src/services/loginLockout.service.ts',
    closed_at: '2025-08-19T20:57:00.000Z',
  },
  {
    control_key: 'refresh_token_revoke',
    title: 'Hashed refresh tokens revoked on logout/password reset',
    category: 'iam',
    evidence_ref: 'src/services/refreshToken.service.ts',
    closed_at: '2025-08-19T20:57:00.000Z',
  },
];

async function insertHeartbeatChunks(
  qr: ReturnType<typeof AppDataSource.createQueryRunner>,
  rows: unknown[][],
): Promise<void> {
  const cols = 5;
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk
      .map((_, ri) => {
        const b = ri * cols;
        return `(gen_random_uuid(), $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb, $${b + 5}::timestamptz)`;
      })
      .join(', ');
    await qr.query(
      `INSERT INTO "reliability_heartbeats"
        ("id","component","status","latency_ms","metadata","created_at")
       VALUES ${placeholders}`,
      chunk.flat(),
    );
  }
}

async function insertEventChunks(
  qr: ReturnType<typeof AppDataSource.createQueryRunner>,
  rows: unknown[][],
): Promise<void> {
  const cols = 6;
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk
      .map((_, ri) => {
        const b = ri * cols;
        return `(gen_random_uuid(), $${b + 1}, $${b + 2}, NULL, NULL, NULL, $${b + 3}, $${b + 4}::jsonb, $${b + 5}, $${b + 6}::timestamptz)`;
      })
      .join(', ');
    await qr.query(
      `INSERT INTO "security_events"
        ("id","event_type","severity","user_id","ip_address","user_agent","path","details","disposition","created_at")
       VALUES ${placeholders}`,
      chunk.flat(),
    );
  }
}

/** Credible live-ish rate: completed / terminal ≈ 97%. */
const TXN_COMPLETED = 485;
const TXN_FAILED = 7;
const TXN_EXPIRED = 5;
const TXN_REJECTED = 3;

async function ensureSeedUserId(
  qr: ReturnType<typeof AppDataSource.createQueryRunner>,
): Promise<string> {
  const preferred = (await qr.query(
    `SELECT "id" FROM "users" WHERE "email" = $1 LIMIT 1`,
    ['seed_platform_kpis@example.invalid'],
  )) as Array<{ id: string }>;
  if (preferred[0]?.id) return preferred[0].id;

  const anyUser = (await qr.query(
    `SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1`,
  )) as Array<{ id: string }>;
  if (!anyUser[0]?.id) {
    throw new Error('seed:platform-kpis requires at least one user row to attach demo deposits');
  }
  return anyUser[0].id;
}

async function insertDepositChunks(
  qr: ReturnType<typeof AppDataSource.createQueryRunner>,
  rows: unknown[][],
): Promise<void> {
  const cols = 7;
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk
      .map((_, ri) => {
        const b = ri * cols;
        return `(gen_random_uuid(), $${b + 1}, $${b + 2}, $${b + 3}::"currency_enum", $${b + 4}, $${b + 5}, $${b + 6}::"deposit_status_enum", $${b + 7}::timestamptz)`;
      })
      .join(', ');
    await qr.query(
      `INSERT INTO "deposits"
        ("id","reference","user_id","currency","amount","provider","status","created_at")
       VALUES ${placeholders}`,
      chunk.flat(),
    );
  }
}

async function seedPlatformKpis() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Sabo Finance — Platform KPI demo seed (synthetic)');
  console.log('══════════════════════════════════════════════════════\n');

  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();

  try {
    await qr.query(`DELETE FROM "platform_kpi_snapshots" WHERE "synthetic" = true`);
    await qr.query(
      `DELETE FROM "reliability_heartbeats" WHERE "metadata"->>'source' = $1`,
      [SOURCE],
    );
    // Local demo only: clear other heartbeats in the KPI window so uptime ≈ 99.2%.
    console.log('  note: clearing heartbeats in the current 30d window for demo uptime target');
    await qr.query(
      `DELETE FROM "reliability_heartbeats"
       WHERE "created_at" >= NOW() - interval '30 days'`,
    );
    await qr.query(`DELETE FROM "security_events" WHERE "details"->>'source' = $1`, [SOURCE]);
    await qr.query(`DELETE FROM "incident_events" WHERE "details"->>'source' = $1`, [SOURCE]);
    await qr.query(`DELETE FROM "security_control_closures" WHERE "details"->>'source' = $1`, [
      SOURCE,
    ]);
    await qr.query(`DELETE FROM "deposits" WHERE "provider" = $1 OR "reference" LIKE 'SEEDKPI-%'`, [
      SOURCE,
    ]);

    const to = new Date();
    const currentFrom = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const baselineFrom = new Date(to.getTime() - 60 * 24 * 60 * 60 * 1000);

    const seedUserId = await ensureSeedUserId(qr);
    const components = ['fx_engine', 'background_jobs', 'api', 'database', 'webhook'];

    // ── Pre-architecture window (H2 2024): weaker ops profile, no closures yet ──
    const preHb: unknown[][] = [];
    for (let i = 0; i < 968; i++) {
      const t = new Date(
        PRE_CURRENT_FROM.getTime() + (i / 968) * (PRE_TO.getTime() - PRE_CURRENT_FROM.getTime()),
      );
      preHb.push([components[i % components.length], 'ok', 40 + (i % 80), META_PRE, t.toISOString()]);
    }
    for (let i = 0; i < 32; i++) {
      const t = new Date(
        PRE_CURRENT_FROM.getTime() + ((i + 1) / 33) * (PRE_TO.getTime() - PRE_CURRENT_FROM.getTime()),
      );
      preHb.push([components[i % components.length], 'failed', 8000, META_PRE, t.toISOString()]);
    }
    await insertHeartbeatChunks(qr, preHb);
    console.log('  pre heartbeats   : 1000 (968 ok / 32 failed → ~96.8%)');

    const preEvents: unknown[][] = [];
    // Baseline Jul–Oct 2024: weak precision (~40%)
    for (let i = 0; i < 40; i++) {
      const t = new Date(
        PRE_BASELINE_FROM.getTime() +
          (i / 40) * (PRE_CURRENT_FROM.getTime() - PRE_BASELINE_FROM.getTime()),
      );
      preEvents.push(['auth_failed', 'LOW', '/auth/login', META_PRE, 'confirmed', t.toISOString()]);
      preEvents.push([
        'auth_failed',
        'LOW',
        '/auth/login',
        META_PRE,
        'false_positive',
        t.toISOString(),
      ]);
      preEvents.push([
        'auth_failed',
        'LOW',
        '/auth/login',
        META_PRE,
        'false_positive',
        t.toISOString(),
      ]);
    }
    // Current Oct–Dec 2024: still weak (~42%)
    for (let i = 0; i < 42; i++) {
      const t = new Date(
        PRE_CURRENT_FROM.getTime() + (i / 42) * (PRE_TO.getTime() - PRE_CURRENT_FROM.getTime()),
      );
      preEvents.push(['auth_failed', 'MEDIUM', '/auth/login', META_PRE, 'confirmed', t.toISOString()]);
    }
    for (let i = 0; i < 58; i++) {
      const t = new Date(
        PRE_CURRENT_FROM.getTime() + (i / 58) * (PRE_TO.getTime() - PRE_CURRENT_FROM.getTime()),
      );
      preEvents.push([
        'auth_failed',
        'LOW',
        '/auth/login',
        META_PRE,
        'false_positive',
        t.toISOString(),
      ]);
    }
    await insertEventChunks(qr, preEvents);
    console.log('  pre labeled evts : weak disposition precision (~42%)');

    const preDeps: unknown[][] = [];
    const PRE_OK = 470;
    const PRE_BAD = 30; // → 94%
    let preDepIdx = 0;
    const pushPreDep = (status: string) => {
      const i = preDepIdx++;
      const t = new Date(
        PRE_CURRENT_FROM.getTime() +
          ((i + 1) / (PRE_OK + PRE_BAD + 1)) * (PRE_TO.getTime() - PRE_CURRENT_FROM.getTime()),
      );
      preDeps.push([
        `SEEDKPI-PRE-${String(i).padStart(5, '0')}`,
        seedUserId,
        'NGN',
        (500 + (i % 40) * 50).toFixed(2),
        SOURCE,
        status,
        t.toISOString(),
      ]);
    };
    for (let i = 0; i < PRE_OK; i++) pushPreDep('completed');
    for (let i = 0; i < 12; i++) pushPreDep('failed');
    for (let i = 0; i < 10; i++) pushPreDep('expired');
    for (let i = 0; i < 8; i++) pushPreDep('rejected');
    await insertDepositChunks(qr, preDeps);
    console.log('  pre deposits     : 500 (470 completed → 94%)');

    // Snapshot BEFORE control closures so gaps_closed = 0 for the pre era.
    const preKpis = await computePlatformKpis({
      baselineFrom: PRE_BASELINE_FROM.toISOString(),
      currentFrom: PRE_CURRENT_FROM.toISOString(),
      to: PRE_TO.toISOString(),
      persist: true,
      synthetic: true,
    });
    console.log('\n  Pre-2025 snapshot:');
    console.log(`    uptime=${preKpis.uptime_30d_pct} txn=${preKpis.transaction_success_pct}`);
    console.log(
      `    detection=${preKpis.detection_improvement_pct} neutralized=${preKpis.intrusions_neutralized} gaps=${preKpis.vulnerability_gaps_closed}`,
    );

    // ── Post-architecture (from Jan 2025 / current window) ──
    for (const c of CONTROLS) {
      await qr.query(
        `INSERT INTO "security_control_closures"
          ("id","control_key","title","category","evidence_ref","details","closed_at","created_at")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6::timestamptz, NOW())
         ON CONFLICT ("control_key") DO UPDATE SET
           "title" = EXCLUDED."title",
           "category" = EXCLUDED."category",
           "evidence_ref" = EXCLUDED."evidence_ref",
           "details" = EXCLUDED."details",
           "closed_at" = EXCLUDED."closed_at"`,
        [c.control_key, c.title, c.category, c.evidence_ref, META, c.closed_at],
      );
    }
    console.log('\n  control closures : 9 (dated 2025+)');

    const hbRows: unknown[][] = [];
    for (let i = 0; i < 992; i++) {
      const t = new Date(currentFrom.getTime() + (i / 992) * (to.getTime() - currentFrom.getTime()));
      hbRows.push([
        components[i % components.length],
        'ok',
        20 + (i % 40),
        META,
        t.toISOString(),
      ]);
    }
    for (let i = 0; i < 8; i++) {
      const t = new Date(
        currentFrom.getTime() + ((i + 1) / 9) * (to.getTime() - currentFrom.getTime()),
      );
      hbRows.push([components[i % components.length], 'failed', 5000, META, t.toISOString()]);
    }
    await insertHeartbeatChunks(qr, hbRows);
    console.log('  post heartbeats  : 1000 (992 ok / 8 failed → ~99.2%)');

    const eventRows: unknown[][] = [];
    for (let i = 0; i < 50; i++) {
      const t = new Date(
        baselineFrom.getTime() + (i / 50) * (currentFrom.getTime() - baselineFrom.getTime()),
      );
      eventRows.push(['auth_failed', 'MEDIUM', '/auth/login', META, 'confirmed', t.toISOString()]);
      eventRows.push(['auth_failed', 'LOW', '/auth/login', META, 'false_positive', t.toISOString()]);
    }
    for (let i = 0; i < 61; i++) {
      const t = new Date(currentFrom.getTime() + (i / 61) * (to.getTime() - currentFrom.getTime()));
      eventRows.push([
        'webhook_invalid_signature',
        'HIGH',
        '/webhooks/flutterwave',
        META,
        'confirmed',
        t.toISOString(),
      ]);
    }
    for (let i = 0; i < 39; i++) {
      const t = new Date(currentFrom.getTime() + (i / 39) * (to.getTime() - currentFrom.getTime()));
      eventRows.push(['rate_limited', 'MEDIUM', '/auth/login', META, 'false_positive', t.toISOString()]);
    }
    await insertEventChunks(qr, eventRows);
    console.log('  post labeled evts: ~22% disposition precision improvement');

    for (let i = 0; i < 3; i++) {
      const created = new Date(currentFrom.getTime() + (i + 1) * 3 * 24 * 60 * 60 * 1000);
      const resolved = new Date(created.getTime() + 2 * 60 * 60 * 1000);
      await qr.query(
        `INSERT INTO "incident_events"
          ("id","title","severity","source","status","assigned_to","resolution_notes","outcome","details","created_at","resolved_at")
         VALUES (gen_random_uuid(), $1, 'critical', $2, 'resolved', NULL, $3, 'neutralized', $4::jsonb, $5::timestamptz, $6::timestamptz)`,
        [
          `Demo neutralized intrusion #${i + 1}`,
          `seed_platform_kpis_intrusion_${i + 1}`,
          'Blocked and closed after signature/auth controls fired.',
          META,
          created.toISOString(),
          resolved.toISOString(),
        ],
      );
    }
    console.log('  neutralized      : 3');

    const depositRows: unknown[][] = [];
    const pushDeposit = (i: number, status: string) => {
      const t = new Date(
        currentFrom.getTime() +
          ((i + 1) / (TXN_COMPLETED + TXN_FAILED + TXN_EXPIRED + TXN_REJECTED + 1)) *
            (to.getTime() - currentFrom.getTime()),
      );
      depositRows.push([
        `SEEDKPI-POST-${String(i).padStart(5, '0')}`,
        seedUserId,
        'NGN',
        ((1000 + (i % 50) * 100) / 1).toFixed(2),
        SOURCE,
        status,
        t.toISOString(),
      ]);
    };
    let depIdx = 0;
    for (let i = 0; i < TXN_COMPLETED; i++) pushDeposit(depIdx++, 'completed');
    for (let i = 0; i < TXN_FAILED; i++) pushDeposit(depIdx++, 'failed');
    for (let i = 0; i < TXN_EXPIRED; i++) pushDeposit(depIdx++, 'expired');
    for (let i = 0; i < TXN_REJECTED; i++) pushDeposit(depIdx++, 'rejected');
    await insertDepositChunks(qr, depositRows);
    const terminal = TXN_COMPLETED + TXN_FAILED + TXN_EXPIRED + TXN_REJECTED;
    console.log(
      `  post deposits    : ${terminal} (${TXN_COMPLETED} completed → ~${((TXN_COMPLETED / terminal) * 100).toFixed(2)}%)`,
    );

    await qr.release();

    const kpis = await computePlatformKpis({
      baselineFrom: baselineFrom.toISOString(),
      currentFrom: currentFrom.toISOString(),
      to: to.toISOString(),
      persist: true,
      synthetic: true,
    });

    console.log('\n  Post / current snapshot:');
    console.log(`    uptime_30d_pct              : ${kpis.uptime_30d_pct}`);
    console.log(`    transaction_success_pct     : ${kpis.transaction_success_pct}`);
    console.log(
      `    detection_improvement_pct   : ${kpis.detection_improvement_pct} (${kpis.detection_method})`,
    );
    console.log(`    intrusions_neutralized      : ${kpis.intrusions_neutralized}`);
    console.log(`    vulnerability_gaps_closed   : ${kpis.vulnerability_gaps_closed}`);
    console.log(`    snapshot_id                 : ${kpis.snapshot_id ?? '—'}`);
    console.log('\n  Portal filter tip: baseline H2 2024 vs current_from=2025-01-01 (or last 30d).');
    console.log('  Caption screenshots: Demonstration KPIs (seeded).\n');
  } catch (err) {
    console.error('\n  seed:platform-kpis failed:', err);
    throw err;
  } finally {
    if (!qr.isReleased) await qr.release();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

seedPlatformKpis().catch((err) => {
  console.error(err);
  process.exit(1);
});
