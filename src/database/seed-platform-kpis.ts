/**
 * Demo seed for platform KPIs (local / staging only).
 *
 * Targets (synthetic):
 *   uptime_30d_pct ≈ 99.2
 *   detection_improvement_pct ≈ 22 (disposition precision)
 *   intrusions_neutralized = 3
 *   vulnerability_gaps_closed = 9
 *
 * Do NOT cite as production history. Caption screenshots as demonstration.
 *
 * Usage: npm run migration:run && npm run seed:platform-kpis
 */

import 'reflect-metadata';

import { AppDataSource } from './data-source';
import { computePlatformKpis } from '../services/platformKpi.service';

const SOURCE = 'seed_platform_kpis';
const META = JSON.stringify({ source: SOURCE, synthetic: true });

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
    closed_at: '2026-03-19T12:00:00.000Z',
  },
  {
    control_key: 'webhook_timing_safe_hash',
    title: 'Flutterwave verif-hash with timingSafeEqual',
    category: 'webhook',
    evidence_ref: 'src/providers/payments/FlutterwaveProvider.ts',
    closed_at: '2026-03-19T12:00:00.000Z',
  },
  {
    control_key: 'webhook_amount_replay_guard',
    title: 'Amount/currency match + replay guard on deposits',
    category: 'webhook',
    evidence_ref: 'src/modules/deposits/deposits.controller.ts',
    closed_at: '2026-03-19T12:00:00.000Z',
  },
  {
    control_key: 'kyc_money_gate',
    title: 'KYC gate on money-moving routes',
    category: 'access',
    evidence_ref: 'src/middleware/kycMiddleware.ts',
    closed_at: '2026-03-19T12:00:00.000Z',
  },
  {
    control_key: 'admin_permission_matrix',
    title: 'Admin least-privilege permission matrix',
    category: 'iam',
    evidence_ref: 'src/security/permissionMatrix.ts',
    closed_at: '2026-06-14T23:35:00.000Z',
  },
  {
    control_key: 'security_event_pipeline',
    title: 'Security event pipeline + threat APIs',
    category: 'detection',
    evidence_ref: 'src/services/securityEvent.service.ts',
    closed_at: '2026-06-14T23:35:00.000Z',
  },
  {
    control_key: 'anomaly_fx_monitoring',
    title: 'FX / job / API anomaly detection engine',
    category: 'reliability',
    evidence_ref: 'src/services/anomaly-detector.service.ts',
    closed_at: '2026-06-14T23:35:00.000Z',
  },
  {
    control_key: 'login_lockout_rate_limit',
    title: 'Login lockout + auth rate limits + Helmet',
    category: 'iam',
    evidence_ref: 'src/services/loginLockout.service.ts',
    closed_at: '2026-08-19T20:57:00.000Z',
  },
  {
    control_key: 'refresh_token_revoke',
    title: 'Hashed refresh tokens revoked on logout/password reset',
    category: 'iam',
    evidence_ref: 'src/services/refreshToken.service.ts',
    closed_at: '2026-08-19T20:57:00.000Z',
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

    const to = new Date();
    const currentFrom = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const baselineFrom = new Date(to.getTime() - 60 * 24 * 60 * 60 * 1000);

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
    console.log('  control closures : 9');

    const components = ['fx_engine', 'background_jobs', 'api', 'database', 'webhook'];
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
    console.log('  heartbeats       : 1000 (992 ok / 8 failed)');

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
    console.log('  labeled events   : 200');

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

    await qr.release();

    const kpis = await computePlatformKpis({
      baselineFrom: baselineFrom.toISOString(),
      currentFrom: currentFrom.toISOString(),
      to: to.toISOString(),
      persist: true,
      synthetic: true,
    });

    console.log('\n  Computed KPIs (synthetic snapshot):');
    console.log(`    uptime_30d_pct              : ${kpis.uptime_30d_pct}`);
    console.log(`    detection_improvement_pct   : ${kpis.detection_improvement_pct} (${kpis.detection_method})`);
    console.log(`    intrusions_neutralized      : ${kpis.intrusions_neutralized}`);
    console.log(`    vulnerability_gaps_closed   : ${kpis.vulnerability_gaps_closed}`);
    console.log(`    snapshot_id                 : ${kpis.snapshot_id ?? '—'}`);
    console.log('\n  Caption screenshots: Demonstration KPIs (seeded).\n');
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
