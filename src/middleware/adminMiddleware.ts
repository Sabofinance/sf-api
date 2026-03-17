import type { NextFunction, Request, Response } from 'express';

import { ForbiddenError, UnauthorizedError } from '../utils/errors';

export function adminMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new UnauthorizedError());
  if (req.user.role !== 'admin') return next(new ForbiddenError('Admin access required'));
  return next();
}

