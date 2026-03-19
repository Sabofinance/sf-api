import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env';
import { UnauthorizedError } from '../utils/errors';

export type AuthUser = {
  id: string;
  role: 'user' | 'admin';
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

  const token = header.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET ?? '') as { sub: string; role?: 'user' | 'admin' };
    console.log(payload)
    if (!payload?.sub) return next(new UnauthorizedError('Invalid token'));
    req.user = { id: payload.sub, role: payload.role ?? 'user' };
    return next();
  } catch (err) {
    console.log('JWT Verification Error:', err);
    return next(new UnauthorizedError('Invalid token'));
  }
}

