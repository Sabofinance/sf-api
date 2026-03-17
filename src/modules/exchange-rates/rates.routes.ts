import { Router } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';

import { getRates } from './rates.controller';

export const ratesRouter = Router();

ratesRouter.get('/', asyncHandler(getRates));

