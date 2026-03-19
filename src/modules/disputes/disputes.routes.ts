import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { requireVerifiedUser } from '../../middleware/kycMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { raiseDispute, listUserDisputes, getDispute } from './disputes.controller';

export const disputesRouter = Router();

disputesRouter.use(authMiddleware, requireVerifiedUser);

disputesRouter.post('/raise', asyncHandler(raiseDispute));
disputesRouter.get('/', asyncHandler(listUserDisputes));
disputesRouter.get('/:id', asyncHandler(getDispute));