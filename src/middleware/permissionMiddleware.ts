import type { NextFunction, Request, Response } from 'express';

import { getPermissionMatrix, roleHasPermission } from '../security/permissionMatrix';
import { recordSecurityEvent } from '../services/securityEvent.service';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import type { Permission } from '../utils/observabilityEnums';
import { SecurityEventType } from '../utils/observabilityEnums';

export function requirePermission(permission: Permission) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    if (!roleHasPermission(req.user.role, permission)) {
      await recordSecurityEvent({
        eventType: SecurityEventType.permission_denied,
        req,
        userId: req.user.id,
        details: { permission, role: req.user.role },
      });
      return next(new ForbiddenError(`Missing permission: ${permission}`));
    }

    return next();
  };
}
