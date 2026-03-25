import { Router } from 'express';

import { adminMiddleware } from '../../middleware/adminMiddleware';
import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import {
  adminLogin,
  adminVerifyOtp,
  approveDeposit,
  rejectDeposit,
  listUsers,
  getUser,
  suspendUser,
  reinstateUser,
  listKycSubmissions,
  approveKyc,
  rejectKyc,
  getDashboardStats,
  getImpactAnalytics,
  listAllDeposits,
  listAllDisputes,
  listAllTransactions,
} from './admin.controller';

export const adminRouter = Router();

// Public Admin Auth
adminRouter.post('/auth/login', asyncHandler(adminLogin));
adminRouter.post('/auth/verify-otp', asyncHandler(adminVerifyOtp));

// Protected Admin Routes
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

// Dashboard & Analytics
adminRouter.get('/dashboard', asyncHandler(getDashboardStats));
adminRouter.get('/analytics/impact', asyncHandler(getImpactAnalytics));
adminRouter.get('/deposits', asyncHandler(listAllDeposits));
adminRouter.get('/disputes', asyncHandler(listAllDisputes));
adminRouter.get('/transactions', asyncHandler(listAllTransactions));

