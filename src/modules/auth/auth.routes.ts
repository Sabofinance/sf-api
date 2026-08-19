import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { authRateLimiter } from '../../middleware/rateLimiter';
import { asyncHandler } from '../../utils/asyncHandler';
import { login, logout, register, forgotPassword, resetPassword, verifyOtp, resendOtp, refreshToken, getMe, verifyEmail, googleSignup, googleInitiate, googleCallback } from './auth.controller';

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, asyncHandler(register));
authRouter.post('/login', authRateLimiter, asyncHandler(login));
authRouter.post('/logout', authMiddleware, asyncHandler(logout));
authRouter.get('/me', authMiddleware, asyncHandler(getMe));
authRouter.post('/forgot-password', authRateLimiter, asyncHandler(forgotPassword));
authRouter.post('/reset-password', asyncHandler(resetPassword));
authRouter.post('/verify-otp', asyncHandler(verifyOtp));
authRouter.post('/resend-otp', authRateLimiter, asyncHandler(resendOtp));
authRouter.post('/refresh-token', authRateLimiter, asyncHandler(refreshToken));
authRouter.get('/verify-email', asyncHandler(verifyEmail));
authRouter.post('/google-signup', asyncHandler(googleSignup));
authRouter.get('/google', asyncHandler(googleInitiate));
authRouter.get('/google/callback', asyncHandler(googleCallback));

