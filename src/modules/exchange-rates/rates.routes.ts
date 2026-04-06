import { Router } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';

import { getRateHistory, getRates } from './rates.controller';

export const ratesRouter = Router();

ratesRouter.get('/', asyncHandler(getRates));
ratesRouter.get('/history/:pair', asyncHandler(getRateHistory));
