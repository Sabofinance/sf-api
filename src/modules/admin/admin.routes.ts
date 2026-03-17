import { Router } from 'express';

import { adminMiddleware } from '../../middleware/adminMiddleware';
import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { approveDeposit, rejectDeposit } from './admin.controller';

export const adminRouter = Router();

adminRouter.post('/deposits/:id/approve', authMiddleware, adminMiddleware, asyncHandler(approveDeposit));
adminRouter.post('/deposits/:id/reject', authMiddleware, adminMiddleware, asyncHandler(rejectDeposit));

