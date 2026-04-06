import type { Request, Response } from 'express';
import { z } from 'zod';

import { withTransaction } from '../../database/transaction';
import { created, ok } from '../../utils/apiResponse';
import { Currency } from '../../utils/enums';
import { AppError, NotFoundError, UnauthorizedError } from '../../utils/errors';

const createSchema = z.object({
  currency: z.nativeEnum(Currency),
  bank_name: z.string().min(2),
  account_name: z.string().min(2),
  account_number: z.string().min(5),
  sort_code: z.string().optional(),
  iban: z.string().optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

/**
 * @swagger
 * /beneficiaries:
 *   post:
 *     summary: Create a new beneficiary
 *     tags: [Beneficiaries]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currency, bank_name, account_name, account_number]
 *             properties:
 *               currency: { $ref: "#/components/schemas/Currency" }
 *               bank_name: { type: string, example: "First Bank" }
 *               account_name: { type: string, example: "John Doe" }
 *               account_number: { type: string, example: "1234567890" }
 *               sort_code: { type: string, example: "01-02-03" }
 *               iban: { type: string, example: "GB29NWBK60161331926819" }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function createBeneficiary(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const input = createSchema.parse(req.body);

  const beneficiary = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `INSERT INTO "beneficiaries" ("id","user_id","currency","bank_name","account_name","account_number","sort_code","iban")
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        req.user!.id,
        input.currency,
        input.bank_name,
        input.account_name,
        input.account_number,
        input.sort_code,
        input.iban,
      ],
    )) as Array<Record<string, unknown>>;
    return rows[0];
  });

  return created(res, { beneficiary });
}

/**
 * @swagger
 * /beneficiaries:
 *   get:
 *     summary: List user beneficiaries
 *     tags: [Beneficiaries]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
const paginationSchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('50'),
});

export async function listBeneficiaries(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { page, limit } = paginationSchema.parse(req.query);
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const result = await withTransaction(async (qr) => {
    const [{ total }] = (await qr.query(
      `SELECT COUNT(*) as total FROM "beneficiaries" WHERE "user_id" = $1`,
      [req.user!.id],
    )) as [{ total: string }];

    const beneficiaries = (await qr.query(
      `SELECT * FROM "beneficiaries" WHERE "user_id" = $1 ORDER BY "is_default" DESC, "created_at" DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, limitNum, offset],
    )) as Array<Record<string, unknown>>;

    return { beneficiaries, total: parseInt(total) };
  });

  return ok(res, { beneficiaries: result.beneficiaries, total: result.total, page: pageNum, limit: limitNum });
}

/**
 * @swagger
 * /beneficiaries/{id}:
 *   delete:
 *     summary: Delete a beneficiary
 *     tags: [Beneficiaries]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function deleteBeneficiary(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);

  await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `DELETE FROM "beneficiaries" WHERE "id" = $1 AND "user_id" = $2 RETURNING id`,
      [id, req.user!.id],
    )) as Array<{ id: string }>;
    if (rows.length === 0) {
      throw new NotFoundError('No beneficiary matches that ID on your account.', 'BENEFICIARY_NOT_FOUND');
    }
  });

  return ok(res, { message: 'Beneficiary deleted successfully' });
}

/**
 * @swagger
 * /beneficiaries/{id}/set-default:
 *   put:
 *     summary: Set a beneficiary as the default for its currency
 *     tags: [Beneficiaries]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function setDefaultBeneficiary(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idSchema.parse(req.params);

  const beneficiary = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT id, currency FROM "beneficiaries" WHERE "id" = $1 AND "user_id" = $2`,
      [id, req.user!.id],
    )) as Array<{ id: string; currency: string }>;

    if (rows.length === 0) {
      throw new NotFoundError('No beneficiary matches that ID on your account.', 'BENEFICIARY_NOT_FOUND');
    }

    const target = rows[0];

    // Unset any existing default for this currency
    await qr.query(
      `UPDATE "beneficiaries" SET "is_default" = false WHERE "user_id" = $1 AND "currency" = $2 AND "is_default" = true`,
      [req.user!.id, target.currency],
    );

    const updated = (await qr.query(
      `UPDATE "beneficiaries" SET "is_default" = true WHERE "id" = $1 RETURNING *`,
      [id],
    )) as Array<Record<string, unknown>>;

    return updated[0];
  });

  return ok(res, { beneficiary });
}