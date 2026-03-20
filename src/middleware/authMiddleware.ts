import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env';
import { UnauthorizedError } from '../utils/errors';
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

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing Bearer token'));
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
    };
    const userId = payload.id ?? payload.sub;
    if (!userId) return next(new UnauthorizedError('Invalid token'));
    req.user = {
      id: userId,
      name: payload.name ?? '',
      email: payload.email ?? '',
      role: payload.role ?? UserRole.user,
      kyc_status: payload.kyc_status ?? 'unverified',
    };
    return next();
  } catch {
    return next(new UnauthorizedError('Invalid token'));
  }
}

