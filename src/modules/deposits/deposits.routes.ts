import { Router } from 'express';
import multer from 'multer';

import { authMiddleware } from '../../middleware/authMiddleware';
import { requireVerifiedUser } from '../../middleware/kycMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import {
  cancelDeposit,
  flutterwaveWebhook,
  getDeposit,
  initiateNgnDeposit,
  listDeposits,
  submitForeignDeposit,
} from './deposits.controller';

export const depositsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

depositsRouter.post('/ngn/initiate', authMiddleware, requireVerifiedUser, asyncHandler(initiateNgnDeposit));
depositsRouter.post('/foreign', authMiddleware, requireVerifiedUser, upload.single('proof'), asyncHandler(submitForeignDeposit));
depositsRouter.get('/', authMiddleware, asyncHandler(listDeposits));
depositsRouter.get('/:id', authMiddleware, asyncHandler(getDeposit));
depositsRouter.post('/:id/cancel', authMiddleware, asyncHandler(cancelDeposit));

export const webhooksRouter = Router();
webhooksRouter.post('/flutterwave', asyncHandler(flutterwaveWebhook));

