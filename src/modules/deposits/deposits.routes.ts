import { Router } from 'express';
import multer from 'multer';

import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  flutterwaveWebhook,
  getDeposit,
  initiateNgnDeposit,
  listDeposits,
  submitForeignDeposit,
} from './deposits.controller';

export const depositsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

depositsRouter.post('/ngn/initiate', authMiddleware, asyncHandler(initiateNgnDeposit));
depositsRouter.post('/foreign', authMiddleware, upload.single('proof'), asyncHandler(submitForeignDeposit));
depositsRouter.get('/', authMiddleware, asyncHandler(listDeposits));
depositsRouter.get('/:id', authMiddleware, asyncHandler(getDeposit));

export const webhooksRouter = Router();
webhooksRouter.post('/flutterwave', asyncHandler(flutterwaveWebhook));

