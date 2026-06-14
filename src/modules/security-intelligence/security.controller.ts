import type { Request, Response } from 'express';
import { z } from 'zod';

import { getPermissionMatrix } from '../../security/permissionMatrix';
import { getThreatMetrics, recordSecurityEvent } from '../../services/securityEvent.service';
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

export async function listSecurityEvents(req: Request, res: Response) {
  const query = eventsQuerySchema.parse(req.query);
  const offset = (query.page - 1) * query.limit;

  const events = await withTransaction(async (qr) => {
    const params: unknown[] = [query.limit, offset];
    let where = '';
    if (query.severity) {
      where = 'WHERE "severity" = $3';
      params.push(query.severity);
    }

    return (await qr.query(
      `SELECT "id","event_type","severity","user_id","ip_address","user_agent","path","details","created_at"
       FROM "security_events"
       ${where}
       ORDER BY "created_at" DESC
       LIMIT $1 OFFSET $2`,
      params,
    )) as Array<Record<string, unknown>>;
  });

  return ok(res, { events, page: query.page, limit: query.limit });
}

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

export async function getPermissionMatrixHandler(_req: Request, res: Response) {
  return ok(res, { matrix: getPermissionMatrix() });
}

// Re-export for instrumentation from other modules - removed, use services/securityEvent.service directly
