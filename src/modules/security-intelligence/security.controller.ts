import type { Request, Response } from 'express';
import { z } from 'zod';

import { getPermissionMatrix } from '../../security/permissionMatrix';
import { getThreatMetrics } from '../../services/securityEvent.service';
import {
  computePlatformKpis,
  listPlatformKpiSnapshots,
} from '../../services/platformKpi.service';
import { withTransaction } from '../../database/transaction';
import { ok } from '../../utils/apiResponse';

const eventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  severity: z.string().optional(),
});

const threatMetricsQuerySchema = z.object({
  baseline_from: z.string().datetime({ offset: true }).optional(),
  current_from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const auditExtractQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

const platformKpisQuerySchema = z.object({
  baseline_from: z.string().datetime({ offset: true }).optional(),
  current_from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  persist: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  synthetic: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.join(',');
  const lines = rows.map((row) =>
    columns
      .map((col) => {
        const val = row[col];
        const str = val === null || val === undefined ? '' : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(','),
  );
  return [header, ...lines].join('\n');
}

/**
 * @swagger
 * /admin/security/threat-metrics:
 *   get:
 *     summary: Security threat metrics (super_admin)
 *     tags: [Admin Security]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       403:
 *         description: Missing security.view permission
 */
export async function getSecurityThreatMetrics(req: Request, res: Response) {
  const query = threatMetricsQuerySchema.parse(req.query);
  const to = query.to ?? new Date().toISOString();
  const currentFrom = query.current_from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const baselineFrom =
    query.baseline_from ?? new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const metrics = await getThreatMetrics(baselineFrom, currentFrom, currentFrom, to);

  return ok(res, {
    ...metrics,
    generated_at: new Date().toISOString(),
  });
}

/**
 * @swagger
 * /admin/security/events:
 *   get:
 *     summary: List security events (super_admin)
 *     tags: [Admin Security]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
export async function listSecurityEvents(req: Request, res: Response) {
  const query = eventsQuerySchema.parse(req.query);
  const offset = (query.page - 1) * query.limit;

  const { events, total } = await withTransaction(async (qr) => {
    const listParams: unknown[] = [query.limit, offset];
    const countParams: unknown[] = [];
    let where = '';
    if (query.severity) {
      where = 'WHERE "severity" = $1';
      countParams.push(query.severity);
      listParams.push(query.severity);
    }

    const countSql = `SELECT COUNT(*)::int AS n FROM "security_events" ${
      query.severity ? 'WHERE "severity" = $1' : ''
    }`;
    const countRows = (await qr.query(countSql, countParams)) as Array<{ n: number }>;
    const total = Number(countRows[0]?.n ?? 0);

    const listWhere = query.severity ? 'WHERE "severity" = $3' : '';
    const rows = (await qr.query(
      `SELECT "id","event_type","severity","user_id","ip_address","user_agent","path","details","created_at"
       FROM "security_events"
       ${listWhere}
       ORDER BY "created_at" DESC
       LIMIT $1 OFFSET $2`,
      listParams,
    )) as Array<Record<string, unknown>>;

    return { events: rows, total };
  });

  return ok(res, { events, total, page: query.page, limit: query.limit });
}

/**
 * @swagger
 * /admin/security/audit-extract:
 *   get:
 *     summary: Audit extract of admin logs and security events (super_admin)
 *     tags: [Admin Security]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
export async function getSecurityAuditExtract(req: Request, res: Response) {
  const query = auditExtractQuerySchema.parse(req.query);
  const to = query.to ?? new Date().toISOString();
  const from = query.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const extract = await withTransaction(async (qr) => {
    const adminLogs = (await qr.query(
      `SELECT al."id", al."admin_id", al."action", al."target_type", al."target_id", al."details", al."created_at",
              u."email" AS admin_email
       FROM "admin_logs" al
       LEFT JOIN "users" u ON u."id" = al."admin_id"
       WHERE al."created_at" BETWEEN $1::timestamptz AND $2::timestamptz
       ORDER BY al."created_at" DESC`,
      [from, to],
    )) as Array<Record<string, unknown>>;

    const securityEvents = (await qr.query(
      `SELECT "id","event_type","severity","user_id","ip_address","path","details","created_at"
       FROM "security_events"
       WHERE "created_at" BETWEEN $1::timestamptz AND $2::timestamptz
       ORDER BY "created_at" DESC`,
      [from, to],
    )) as Array<Record<string, unknown>>;

    const permissionViolations = securityEvents.filter(
      (e) => e.event_type === 'permission_denied' || e.event_type === 'forbidden' || e.event_type === 'unauthorized_admin',
    );

    return { admin_logs: adminLogs, security_events: securityEvents, permission_violations: permissionViolations };
  });

  if (query.format === 'csv') {
    const rows = [
      ...extract.admin_logs.map((r) => ({ source: 'admin_log', ...r })),
      ...extract.security_events.map((r) => ({ source: 'security_event', ...r })),
    ];
    const csv = toCsv(rows, ['source', 'id', 'created_at', 'action', 'event_type', 'severity', 'admin_email', 'path']);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-extract.csv"');
    return res.status(200).send(csv);
  }

  return ok(res, { ...extract, from, to, generated_at: new Date().toISOString() });
}

/**
 * @swagger
 * /admin/security/permissions:
 *   get:
 *     summary: Export role permission matrix (super_admin)
 *     tags: [Admin Security]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
export async function getPermissionMatrixHandler(_req: Request, res: Response) {
  return ok(res, { matrix: getPermissionMatrix() });
}

/**
 * @swagger
 * /admin/security/platform-kpis:
 *   get:
 *     summary: Platform KPIs (uptime, detection improvement, neutralized intrusions, closed controls)
 *     tags: [Admin Security]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: persist
 *         schema: { type: string, enum: [true, false] }
 *         description: Persist a snapshot row when true
 *     responses:
 *       200:
 *         description: OK
 */
export async function getPlatformKpisHandler(req: Request, res: Response) {
  const query = platformKpisQuerySchema.parse(req.query);
  const kpis = await computePlatformKpis({
    baselineFrom: query.baseline_from,
    currentFrom: query.current_from,
    to: query.to,
    persist: query.persist,
    synthetic: query.synthetic,
  });
  return ok(res, kpis);
}

/**
 * @swagger
 * /admin/security/platform-kpis/snapshots:
 *   get:
 *     summary: List recent platform KPI snapshots
 *     tags: [Admin Security]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
export async function listPlatformKpiSnapshotsHandler(req: Request, res: Response) {
  const limit = z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit ?? 20);
  const snapshots = await listPlatformKpiSnapshots(limit);
  return ok(res, { snapshots });
}