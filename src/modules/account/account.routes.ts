import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { updateUsername, setTransactionPin, verifyTransactionPin } from './account.controller';

export const accountRouter = Router();

// All account routes require authentication
accountRouter.use(authMiddleware);

accountRouter.put('/username', asyncHandler(updateUsername));
accountRouter.post('/transaction-pin/set', asyncHandler(setTransactionPin));
accountRouter.post('/transaction-pin/verify', asyncHandler(verifyTransactionPin));