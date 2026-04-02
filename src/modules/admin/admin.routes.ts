import { Router } from 'express';
import multer from 'multer';

import { adminMiddleware } from '../../middleware/adminMiddleware';
import { authMiddleware } from '../../middleware/authMiddleware';
import { superAdminMiddleware } from '../../middleware/adminMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { inviteRateLimiter } from '../../middleware/rateLimiter';

import {
  adminLogin,
  adminVerifyOtp,
  inviteAdmin,
  acceptAdminInvite,
  approveDeposit,
  rejectDeposit,
  listUsers,
  getUser,
  suspendUser,
  reinstateUser,
  removeAdmin,
  upgradeAdminToSuperAdmin,
  getAdminProfile,
  updateAdminProfilePicture,
  listAdminLogs,
  listKycSubmissions,
  approveKyc,
  rejectKyc,
  getDashboardStats,
  getImpactAnalytics,
  listAllDeposits,
  listAllDisputes,
  listAllTransactions,
  listAllTrades,
  verifyFlutterwaveDeposit,
} from './admin.controller';

export const adminRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Public Admin Auth
adminRouter.post('/auth/login', asyncHandler(adminLogin));
adminRouter.post('/auth/verify-otp', asyncHandler(adminVerifyOtp));

// Public: accept admin invite token
adminRouter.get('/invites/accept', asyncHandler(acceptAdminInvite));

// Protected Admin Routes
adminRouter.use(authMiddleware, adminMiddleware);

// Super-admin only: invite/remove/upgrade
adminRouter.post('/invites', inviteRateLimiter, superAdminMiddleware, asyncHandler(inviteAdmin));
adminRouter.post('/admins/:id/remove', superAdminMiddleware, asyncHandler(removeAdmin));
adminRouter.post('/admins/:id/upgrade', superAdminMiddleware, asyncHandler(upgradeAdminToSuperAdmin));

// User Management
adminRouter.get('/users', asyncHandler(listUsers));
adminRouter.get('/users/:id', asyncHandler(getUser));
adminRouter.post('/users/:id/suspend', asyncHandler(suspendUser));
adminRouter.post('/users/:id/reinstate', asyncHandler(reinstateUser));

// Admin profile
adminRouter.get('/profile', asyncHandler(getAdminProfile));
adminRouter.post('/profile/picture', upload.single('file'), asyncHandler(updateAdminProfilePicture));

// Admin logs
adminRouter.get('/logs', asyncHandler(listAdminLogs));

// KYC Management
adminRouter.get('/kyc', asyncHandler(listKycSubmissions));
adminRouter.post('/kyc/:id/approve', asyncHandler(approveKyc));
adminRouter.post('/kyc/:id/reject', asyncHandler(rejectKyc));

// Deposit Management
adminRouter.post('/deposits/:id/approve', asyncHandler(approveDeposit));
adminRouter.post('/deposits/:id/reject', asyncHandler(rejectDeposit));
adminRouter.post('/deposits/:id/verify-flutterwave', asyncHandler(verifyFlutterwaveDeposit));

// Dashboard & Analytics
adminRouter.get('/dashboard', asyncHandler(getDashboardStats));
adminRouter.get('/analytics/impact', asyncHandler(getImpactAnalytics));
adminRouter.get('/deposits', asyncHandler(listAllDeposits));
adminRouter.get('/trades', asyncHandler(listAllTrades));
adminRouter.get('/disputes', asyncHandler(listAllDisputes));
adminRouter.get('/transactions', asyncHandler(listAllTransactions));

