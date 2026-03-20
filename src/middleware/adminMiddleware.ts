import type { NextFunction, Request, Response } from 'express';

import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import { UserRole } from '../utils/enums';

export function adminMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new UnauthorizedError());
  if (req.user.role !== UserRole.admin && req.user.role !== UserRole.super_admin) {
    return next(new ForbiddenError('Admin access required'));
  }
  return next();
}

export function superAdminMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new UnauthorizedError());
  if (req.user.role !== UserRole.super_admin) {
    return next(new ForbiddenError('Super Admin access required'));
  }
  return next();
}

