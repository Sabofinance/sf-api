import { Router } from 'express';
import multer from 'multer';

import { adminMiddleware } from '../../middleware/adminMiddleware';
import { superAdminMiddleware } from '../../middleware/adminMiddleware';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requirePermission } from '../../middleware/permissionMiddleware';
import { authRateLimiter } from '../../middleware/rateLimiter';
import { inviteRateLimiter } from '../../middleware/rateLimiter';
import { asyncHandler } from '../../utils/asyncHandler';
import { reliabilityRouter } from '../reliability/reliability.routes';
import { securityIntelligenceRouter } from '../security-intelligence/security.routes';

import {
  adminLogin,
  adminVerifyOtp,
  adminResendOtp,
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
import { adminInviteSetupPage } from './adminInviteSetupPage';
import { createOrUpdateCompanyRate, getCompanyRate, listCompanyRates } from '../company-rates/companyRates.controller';

export const adminRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Public Admin Auth
adminRouter.post('/auth/login', authRateLimiter, asyncHandler(adminLogin));
adminRouter.post('/auth/verify-otp', asyncHandler(adminVerifyOtp));
adminRouter.post('/auth/resend-otp', asyncHandler(adminResendOtp));

// Public: accept / setup admin invite
adminRouter.get('/invites/setup-page', asyncHandler(adminInviteSetupPage));
adminRouter.get('/invites/accept', asyncHandler(acceptAdminInvite));
adminRouter.post('/invites/setup', asyncHandler(completeAdminSetup));

// Protected Admin Routes
adminRouter.use(authMiddleware, adminMiddleware);

// Observability subsystems
adminRouter.use('/reliability', reliabilityRouter);
adminRouter.use('/security', securityIntelligenceRouter);

// Super-admin only: invite/remove/upgrade
adminRouter.get('/admins', superAdminMiddleware, requirePermission('admins.invite'), asyncHandler(listAdmins));
adminRouter.post('/invites', inviteRateLimiter, superAdminMiddleware, requirePermission('admins.invite'), asyncHandler(inviteAdmin));
adminRouter.post('/admins/:id/remove', superAdminMiddleware, requirePermission('admins.remove'), asyncHandler(removeAdmin));
adminRouter.post('/admins/:id/upgrade', superAdminMiddleware, requirePermission('admins.invite'), asyncHandler(upgradeAdminToSuperAdmin));

// User Management
adminRouter.get('/users', requirePermission('users.manage'), asyncHandler(listUsers));
adminRouter.get('/users/:id', requirePermission('users.manage'), asyncHandler(getUser));
adminRouter.post('/users/:id/suspend', requirePermission('users.manage'), asyncHandler(suspendUser));
adminRouter.post('/users/:id/reinstate', requirePermission('users.manage'), asyncHandler(reinstateUser));

// Admin profile
adminRouter.get('/profile', asyncHandler(getAdminProfile));
adminRouter.post('/profile/picture', upload.single('file'), asyncHandler(updateAdminProfilePicture));

// Admin logs
adminRouter.get('/logs', requirePermission('analytics.view'), asyncHandler(listAdminLogs));

// KYC Management
adminRouter.get('/kyc', requirePermission('kyc.approve'), asyncHandler(listKycSubmissions));
adminRouter.post('/kyc/:id/approve', requirePermission('kyc.approve'), asyncHandler(approveKyc));
adminRouter.post('/kyc/:id/reject', requirePermission('kyc.approve'), asyncHandler(rejectKyc));

// Deposit Management
adminRouter.post('/deposits/:id/approve', requirePermission('deposits.approve'), asyncHandler(approveDeposit));
adminRouter.post('/deposits/:id/reject', requirePermission('deposits.approve'), asyncHandler(rejectDeposit));
adminRouter.post('/deposits/:id/verify-flutterwave', requirePermission('deposits.approve'), asyncHandler(verifyFlutterwaveDeposit));

// Company Rate Management
adminRouter.post('/company-rates', requirePermission('company_rates.manage'), asyncHandler(createOrUpdateCompanyRate));
adminRouter.get('/company-rates', requirePermission('analytics.view'), asyncHandler(listCompanyRates));
adminRouter.get('/company-rates/:currency', requirePermission('analytics.view'), asyncHandler(getCompanyRate));

// Dashboard & Analytics
adminRouter.get('/dashboard', requirePermission('analytics.view'), asyncHandler(getDashboardStats));
adminRouter.get('/analytics/impact', requirePermission('analytics.view'), asyncHandler(getImpactAnalytics));
adminRouter.get('/analytics/metrics', requirePermission('analytics.view'), asyncHandler(getMetricsAnalytics));
adminRouter.get('/deposits', requirePermission('deposits.approve'), asyncHandler(listAllDeposits));
adminRouter.get('/trades', requirePermission('analytics.view'), asyncHandler(listAllTrades));
adminRouter.get('/disputes', requirePermission('disputes.resolve'), asyncHandler(listAllDisputes));
adminRouter.post('/disputes/:id/resolve', requirePermission('disputes.resolve'), asyncHandler(resolveDispute));
adminRouter.get('/transactions', requirePermission('analytics.view'), asyncHandler(listAllTransactions));

// Withdrawal Management
adminRouter.get('/withdrawals', requirePermission('withdrawals.approve'), asyncHandler(listAllWithdrawals));
adminRouter.post('/withdrawals/:id/approve', requirePermission('withdrawals.approve'), asyncHandler(approveWithdrawal));
adminRouter.post('/withdrawals/:id/reject', requirePermission('withdrawals.approve'), asyncHandler(rejectWithdrawal));
