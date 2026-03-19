import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { requireVerifiedUser } from '../../middleware/kycMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { createSabit, listSabits, getSabit, cancelSabit } from './sabits.controller';

export const sabitsRouter = Router();

// Public routes
sabitsRouter.get('/', asyncHandler(listSabits));
sabitsRouter.get('/:id', asyncHandler(getSabit));

// Authenticated routes
sabitsRouter.use(authMiddleware);
sabitsRouter.post('/', requireVerifiedUser, asyncHandler(createSabit));
sabitsRouter.post('/:id/cancel', requireVerifiedUser, asyncHandler(cancelSabit));