import { Router } from 'express';
import multer from 'multer';

import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { updateUsername, setTransactionPin, updateProfilePicture } from './account.controller';
import {
  initiateAccountDeletion,
  confirmAccountDeletion,
  initiateEmailChange,
  confirmEmailChange,
} from './account.controller';

import { otpRateLimiter } from '../../middleware/rateLimiter';

export const accountRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// All account routes require authentication
accountRouter.use(authMiddleware);

accountRouter.put('/username', asyncHandler(updateUsername));
accountRouter.post('/transaction-pin/set', asyncHandler(setTransactionPin));
accountRouter.post('/profile/picture', upload.single('file'), asyncHandler(updateProfilePicture));

// Account deletion (soft delete)
accountRouter.post('/delete/initiate', otpRateLimiter, asyncHandler(initiateAccountDeletion));
accountRouter.post('/delete/confirm', asyncHandler(confirmAccountDeletion));

// Email change (OTP to new email + alert old email)
accountRouter.post('/email-change/initiate', otpRateLimiter, asyncHandler(initiateEmailChange));
accountRouter.post('/email-change/confirm', asyncHandler(confirmEmailChange));