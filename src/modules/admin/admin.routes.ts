import { Router } from 'express';

import { adminMiddleware } from '../../middleware/adminMiddleware';
import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import {
  approveDeposit,
  rejectDeposit,
  listUsers,
  getUser,
  suspendUser,
  reinstateUser,
  listKycSubmissions,
  approveKyc,
  rejectKyc,
} from './admin.controller';

export const adminRouter = Router();

adminRouter.use(authMiddleware, adminMiddleware);

// User Management
adminRouter.get('/users', asyncHandler(listUsers));
adminRouter.get('/users/:id', asyncHandler(getUser));
adminRouter.post('/users/:id/suspend', asyncHandler(suspendUser));
adminRouter.post('/users/:id/reinstate', asyncHandler(reinstateUser));

// KYC Management
adminRouter.get('/kyc', asyncHandler(listKycSubmissions));
adminRouter.post('/kyc/:id/approve', asyncHandler(approveKyc));
adminRouter.post('/kyc/:id/reject', asyncHandler(rejectKyc));

// Deposit Management
adminRouter.post('/deposits/:id/approve', asyncHandler(approveDeposit));
adminRouter.post('/deposits/:id/reject', asyncHandler(rejectDeposit));

