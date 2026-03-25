import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { requireVerifiedUser } from '../../middleware/kycMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import {
  acceptBid,
  getMyBids,
  getReceivedBids,
  placeBid,
  rejectBid,
  withdrawBid,
} from './bids.controller';

export const bidsRouter = Router();

bidsRouter.use(authMiddleware);

bidsRouter.post('/', requireVerifiedUser, asyncHandler(placeBid));
bidsRouter.get('/mine', asyncHandler(getMyBids));
bidsRouter.get('/received', asyncHandler(getReceivedBids));
bidsRouter.put('/:id/accept', asyncHandler(acceptBid));
bidsRouter.put('/:id/reject', asyncHandler(rejectBid));
bidsRouter.put('/:id/withdraw', asyncHandler(withdrawBid));
