import { Router } from 'express';
import multer from 'multer';

import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { getKycStatus, uploadKyc } from './kyc.controller';

export const kycRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

kycRouter.post(
  '/upload',
  authMiddleware,
  upload.fields([
    { name: 'document', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  asyncHandler(uploadKyc),
);
kycRouter.get('/status', authMiddleware, asyncHandler(getKycStatus));

