import type { Request, Response } from 'express';

import { z } from 'zod';
import { created, ok } from '../../utils/apiResponse';
import { CompanyRateService } from './companyRates.service';

const currencySchema = z
  .string()
  .trim()
  .min(2, 'Currency is required')
  .max(8, 'Currency must be 2 to 8 characters')
  .regex(/^[A-Za-z]+$/, 'Currency must contain only letters')
  .transform((value) => value.toUpperCase());

const companyRatePayloadSchema = z.object({
  currency: currencySchema,
  rate_ngn: z
    .string()
    .regex(/^[0-9]+(\.[0-9]{1,2})?$/, 'rate_ngn must be a positive decimal with up to 2 decimal places')
    .refine((value) => parseFloat(value) > 0, 'rate_ngn must be a positive amount'),
});

const currencyParamSchema = z.object({ currency: currencySchema });

/**
 * @swagger
 * /company-rates:
 *   get:
 *     summary: Get all company-defined currency rates
 *     tags: [Company Rates]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function listCompanyRates(_req: Request, res: Response) {
  const rates = await CompanyRateService.getAllRates();
  return ok(res, { rates });
}

/**
 * @swagger
 * /company-rates/{currency}:
 *   get:
 *     summary: Get a company-defined rate for a specific currency
 *     tags: [Company Rates]
 *     parameters:
 *       - in: path
 *         name: currency
 *         required: true
 *         schema: { type: string, example: "USD" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getCompanyRate(req: Request, res: Response) {
  const { currency } = currencyParamSchema.parse(req.params);
  const rate = await CompanyRateService.getRateByCurrency(currency);
  return ok(res, { rate });
}

/**
 * @swagger
 * /admin/company-rates:
 *   post:
 *     summary: Create or update a company-defined currency rate
 *     tags: [Company Rates]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               currency:
 *                 type: string
 *                 example: USD
 *               rate_ngn:
 *                 type: string
 *                 example: "1500.00"
 *             required: [currency, rate_ngn]
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function createOrUpdateCompanyRate(req: Request, res: Response) {
  const { currency, rate_ngn } = companyRatePayloadSchema.parse(req.body);
  const rate = await CompanyRateService.createOrUpdateRate(currency, rate_ngn);
  return created(res, { rate });
}
