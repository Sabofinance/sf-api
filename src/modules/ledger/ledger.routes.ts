import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { listLedger, listLedgerByWallet } from './ledger.controller';

export const ledgerRouter = Router();

ledgerRouter.get('/', authMiddleware, asyncHandler(listLedger));
ledgerRouter.get('/:walletId', authMiddleware, asyncHandler(listLedgerByWallet));

