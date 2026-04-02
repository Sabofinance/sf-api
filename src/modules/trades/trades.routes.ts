import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { requireVerifiedUser } from '../../middleware/kycMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { initiateTrade, confirmTrade, completeTrade, sellerConfirmTrade, listUserTrades, getTrade } from './trades.controller';

export const tradesRouter = Router();

tradesRouter.use(authMiddleware, requireVerifiedUser);

tradesRouter.get('/', asyncHandler(listUserTrades));
tradesRouter.get('/:id', asyncHandler(getTrade));
tradesRouter.post('/initiate', asyncHandler(initiateTrade));
tradesRouter.post('/:id/confirm', asyncHandler(confirmTrade));
tradesRouter.put('/:id/seller-confirm', asyncHandler(sellerConfirmTrade));
tradesRouter.post('/:id/complete', asyncHandler(completeTrade));