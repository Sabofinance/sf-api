import { Router } from 'express';

import { adminMiddleware } from '../../middleware/adminMiddleware';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requirePermission } from '../../middleware/permissionMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import {
  getPermissionMatrixHandler,
  getPlatformKpisHandler,
  getSecurityAuditExtract,
  getSecurityThreatMetrics,
  listPlatformKpiSnapshotsHandler,
  listSecurityEvents,
} from './security.controller';

export const securityIntelligenceRouter = Router();

securityIntelligenceRouter.use(authMiddleware, adminMiddleware);

securityIntelligenceRouter.get(
  '/threat-metrics',
  requirePermission('security.view'),
  asyncHandler(getSecurityThreatMetrics),
);
securityIntelligenceRouter.get(
  '/events',
  requirePermission('security.view'),
  asyncHandler(listSecurityEvents),
);
securityIntelligenceRouter.get(
  '/audit-extract',
  requirePermission('security.view'),
  asyncHandler(getSecurityAuditExtract),
);
securityIntelligenceRouter.get(
  '/permissions',
  requirePermission('security.view'),
  asyncHandler(getPermissionMatrixHandler),
);
securityIntelligenceRouter.get(
  '/platform-kpis',
  requirePermission('security.view'),
  asyncHandler(getPlatformKpisHandler),
);
securityIntelligenceRouter.get(
  '/platform-kpis/snapshots',
  requirePermission('security.view'),
  asyncHandler(listPlatformKpiSnapshotsHandler),
);
