import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { requireVerifiedUser } from '../../middleware/kycMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { getWithdrawal, listWithdrawals, requestWithdrawal } from './withdrawals.controller';

export const withdrawalsRouter = Router();

withdrawalsRouter.use(authMiddleware, requireVerifiedUser);

withdrawalsRouter.post('/request', asyncHandler(requestWithdrawal));
withdrawalsRouter.get('/', asyncHandler(listWithdrawals));
withdrawalsRouter.get('/:id', asyncHandler(getWithdrawal));