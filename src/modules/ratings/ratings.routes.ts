import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { requireVerifiedUser } from '../../middleware/kycMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { getUserReputation, submitRating } from './ratings.controller';

export const ratingsRouter = Router();

// Public: Anyone can see a user's reputation
ratingsRouter.get('/user/:id', asyncHandler(getUserReputation));

// Protected: Only verified users who completed a trade can submit a rating
ratingsRouter.post('/', authMiddleware, requireVerifiedUser, asyncHandler(submitRating));