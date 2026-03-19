import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { getWallet, listWallets } from './wallets.controller';

export const walletsRouter = Router();

walletsRouter.get('/', authMiddleware, asyncHandler(listWallets));
walletsRouter.get('/:currency', authMiddleware, asyncHandler(getWallet));

