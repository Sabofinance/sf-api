import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { requireVerifiedUser } from '../../middleware/kycMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';

import { createBeneficiary, deleteBeneficiary, listBeneficiaries } from './beneficiaries.controller';

export const beneficiariesRouter = Router();

beneficiariesRouter.use(authMiddleware, requireVerifiedUser);

beneficiariesRouter.post('/', asyncHandler(createBeneficiary));
beneficiariesRouter.get('/', asyncHandler(listBeneficiaries));
beneficiariesRouter.delete('/:id', asyncHandler(deleteBeneficiary));