import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env';
import { AppDataSource } from '../database/data-source';
import { AppError, UnauthorizedError } from '../utils/errors';
import { UserRole } from '../utils/enums';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  kyc_status: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(
      new UnauthorizedError(
        'Missing Authorization header. Expected: Authorization: Bearer <access_token>.',
        'MISSING_BEARER_TOKEN',
      ),
    );
  }

  const token = header.slice('Bearer '.length).replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
  
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as {
      id?: string;
      sub?: string;
      name?: string;
      email?: string;
      role?: UserRole;
      kyc_status?: string;
      exp?: number;
    };
    const userId = payload.id ?? payload.sub;
    if (!userId) return next(new UnauthorizedError('Access token is missing a valid user identifier.', 'INVALID_TOKEN'));

    // Always load the user to enforce soft-delete and suspension immediately.
    const userRows = (await AppDataSource.query(
      `SELECT "id","name","email","role","kyc_status","is_suspended","deleted_at"
       FROM "users" WHERE "id" = $1 LIMIT 1`,
      [userId],
    )) as Array<{
      id: string;
      name: string;
      email: string;
      role: UserRole;
      kyc_status: string;
      is_suspended: boolean;
      deleted_at: Date | null;
    }>;

    const user = userRows[0];
    if (!user) return next(new UnauthorizedError('Access token does not match an active user.', 'USER_NOT_FOUND'));
    if (user.deleted_at) return next(new AppError('ACCOUNT_DELETED', 'This account has been deleted.', 401));
    if (user.is_suspended) return next(new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.', 401));

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role ?? UserRole.user,
      kyc_status: user.kyc_status ?? 'unverified',
    };

    // Sliding access token window for active sessions.
    if (payload.exp) {
      const secondsLeft = payload.exp - Math.floor(Date.now() / 1000);
      const refreshThresholdSeconds = 10 * 60;

      if (secondsLeft > 0 && secondsLeft <= refreshThresholdSeconds) {
        const renewedToken = jwt.sign(
          {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role ?? UserRole.user,
            kyc_status: user.kyc_status ?? 'unverified',
          },
          env.JWT_SECRET,
          { expiresIn: '30m' },
        );
        _res.setHeader('x-access-token', renewedToken);
        _res.setHeader('x-token-refreshed', 'true');
      }
    }

    return next();
  } catch {
    return next(
      new UnauthorizedError('Access token could not be verified. It may be invalid, malformed, or expired.', 'INVALID_TOKEN'),
    );
  }
}

