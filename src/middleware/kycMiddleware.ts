import type { Request, Response, NextFunction } from 'express';

import { KycStatus } from '../utils/enums';
import { AppError, UnauthorizedError } from '../utils/errors';

export function requireVerifiedUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }

  if (req.user.kyc_status !== KycStatus.verified) {
    return next(
      new AppError(
        'KYC_NOT_VERIFIED',
        'Your account must be verified to perform this action. Please complete your KYC.',
        403,
      ),
    );
  }

  next();
}