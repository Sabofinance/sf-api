import { Router } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { getCompanyRate, listCompanyRates } from './companyRates.controller';

export const companyRatesRouter = Router();

companyRatesRouter.get('/', asyncHandler(listCompanyRates));
companyRatesRouter.get('/:currency', asyncHandler(getCompanyRate));
