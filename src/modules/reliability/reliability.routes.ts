import { Router } from 'express';

import { adminMiddleware } from '../../middleware/adminMiddleware';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requirePermission } from '../../middleware/permissionMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import {
  getReliabilitySummary,
  getReliabilityUptime,
  listReliabilityEvents,
} from './reliability.controller';

export const reliabilityRouter = Router();

reliabilityRouter.use(authMiddleware, adminMiddleware);

reliabilityRouter.get('/summary', requirePermission('reliability.view'), asyncHandler(getReliabilitySummary));
reliabilityRouter.get('/events', requirePermission('reliability.view'), asyncHandler(listReliabilityEvents));
reliabilityRouter.get('/uptime', requirePermission('reliability.view'), asyncHandler(getReliabilityUptime));
