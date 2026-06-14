import type { NextFunction, Request, Response } from 'express';

import { recordSecurityEvent } from '../services/securityEvent.service';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import { UserRole } from '../utils/enums';
import { SecurityEventType } from '../utils/observabilityEnums';

export function adminMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new UnauthorizedError());
  if (req.user.role !== UserRole.admin && req.user.role !== UserRole.super_admin) {
    void recordSecurityEvent({
      eventType: SecurityEventType.unauthorized_admin,
      req,
      userId: req.user.id,
      details: { role: req.user.role },
    });
    return next(new ForbiddenError('Admin access required'));
  }
  return next();
}

export function superAdminMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new UnauthorizedError());
  if (req.user.role !== UserRole.super_admin) {
    void recordSecurityEvent({
      eventType: SecurityEventType.forbidden,
      req,
      userId: req.user.id,
      details: { requiredRole: UserRole.super_admin, role: req.user.role },
    });
    return next(new ForbiddenError('Super Admin access required'));
  }
  return next();
}
