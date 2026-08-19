import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

import { recordSecurityEvent } from '../services/securityEvent.service';
import { SecurityEventType } from '../utils/observabilityEnums';

async function onRateLimited(req: Request, limiterName: string): Promise<void> {
  const eventType =
    limiterName === 'otp' ? SecurityEventType.otp_rate_limited : SecurityEventType.rate_limited;
  await recordSecurityEvent({
    eventType,
    req,
    userId: req.user?.id,
    details: { limiter: limiterName },
  });
}

export const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMIT_IN_TESTS !== 'true',
  handler: (req, res, _next, options) => {
    void onRateLimited(req, 'otp');
    res.status(options.statusCode).json({
      success: false,
      data: null,
      meta: {},
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    });
  },
});

export const inviteRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMIT_IN_TESTS !== 'true',
  handler: (req, res, _next, options) => {
    void onRateLimited(req, 'invite');
    res.status(options.statusCode).json({
      success: false,
      data: null,
      meta: {},
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    });
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMIT_IN_TESTS !== 'true',
  handler: (req, res, _next, options) => {
    void onRateLimited(req, 'auth');
    res.status(options.statusCode).json({
      success: false,
      data: null,
      meta: {},
      error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please try again later.' },
    });
  },
});
