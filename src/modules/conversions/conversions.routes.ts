import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { requireVerifiedUser } from '../../middleware/kycMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { getQuote, executeQuote } from './conversions.controller';

export const conversionsRouter = Router();

conversionsRouter.use(authMiddleware, requireVerifiedUser);

conversionsRouter.post('/quote', asyncHandler(getQuote));
conversionsRouter.post('/execute', asyncHandler(executeQuote));