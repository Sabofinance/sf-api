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
  completeAdminSetup,
  approveDeposit,
  rejectDeposit,
  listUsers,
  getUser,
  listAdmins,
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
  resolveDispute,
  listAllTransactions,
  listAllTrades,
  verifyFlutterwaveDeposit,
  getMetricsAnalytics,
  listAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
} from './admin.controller';

export const adminRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Public Admin Auth
adminRouter.post('/auth/login', asyncHandler(adminLogin));
adminRouter.post('/auth/verify-otp', asyncHandler(adminVerifyOtp));

// Public: accept admin invite token
adminRouter.get('/invites/accept', asyncHandler(acceptAdminInvite));
adminRouter.post('/invites/setup', asyncHandler(completeAdminSetup));

// Protected Admin Routes
adminRouter.use(authMiddleware, adminMiddleware);

// Super-admin only: invite/remove/upgrade
adminRouter.get('/admins', superAdminMiddleware, asyncHandler(listAdmins));
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
adminRouter.get('/analytics/metrics', asyncHandler(getMetricsAnalytics));
adminRouter.get('/deposits', asyncHandler(listAllDeposits));
adminRouter.get('/trades', asyncHandler(listAllTrades));
adminRouter.get('/disputes', asyncHandler(listAllDisputes));
adminRouter.post('/disputes/:id/resolve', asyncHandler(resolveDispute));
adminRouter.get('/transactions', asyncHandler(listAllTransactions));

// Withdrawal Management
adminRouter.get('/withdrawals', asyncHandler(listAllWithdrawals));
adminRouter.post('/withdrawals/:id/approve', asyncHandler(approveWithdrawal));
adminRouter.post('/withdrawals/:id/reject', asyncHandler(rejectWithdrawal));

