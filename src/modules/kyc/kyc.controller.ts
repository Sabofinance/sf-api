import type { Request, Response } from 'express';
import { z } from 'zod';

import { cloudinary } from '../../config/cloudinary';
import { withTransaction } from '../../database/transaction';
import { created, ok } from '../../utils/apiResponse';
import { KycStatus } from '../../utils/enums';
import { AppError, UnauthorizedError } from '../../utils/errors';

const uploadSchema = z.object({
  document_type: z.string().min(2),
});

/**
 * @swagger
 * /kyc/upload:
 *   post:
 *     summary: Upload KYC documents (document + selfie)
 *     tags: [KYC]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document_type, document, selfie]
 *             properties:
 *               document_type: { type: string, example: "passport" }
 *               document: { type: string, format: binary }
 *               selfie: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function uploadKyc(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const input = uploadSchema.parse(req.body);

  const files = (req as any).files as Record<string, Express.Multer.File[]> | undefined;
  const document = files?.document?.[0];
  const selfie = files?.selfie?.[0];
  if (!document || !selfie) throw new AppError('FILES_REQUIRED', 'document and selfie files are required', 400);

  if (!cloudinary.config().cloud_name) {
    throw new AppError('CONFIG_ERROR', 'CLOUDINARY_URL is required for KYC uploads', 500);
  }

  const [docUpload, selfieUpload] = await Promise.all([
    cloudinary.uploader.upload(
      `data:${document.mimetype};base64,${document.buffer.toString('base64')}`,
      { folder: 'sabo-finance/kyc', resource_type: 'image' },
    ),
    cloudinary.uploader.upload(
      `data:${selfie.mimetype};base64,${selfie.buffer.toString('base64')}`,
      { folder: 'sabo-finance/kyc', resource_type: 'image' },
    ),
  ]);

  const kyc = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `INSERT INTO "kyc" ("id","user_id","document_type","document_url","selfie_url","status","rejection_reason","reviewed_by","created_at")
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,NULL,NULL, now())
       RETURNING *`,
      [req.user!.id, input.document_type, docUpload.secure_url, selfieUpload.secure_url, KycStatus.pending],
    )) as Array<Record<string, unknown>>;

    await qr.query(`UPDATE "users" SET "kyc_status" = $1 WHERE "id" = $2`, [KycStatus.pending, req.user!.id]);
    return rows[0];
  });

  return created(res, { kyc });
}

/**
 * @swagger
 * /kyc/status:
 *   get:
 *     summary: Get current KYC status
 *     tags: [KYC]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function getKycStatus(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();
  const result = await withTransaction(async (qr) => {
    const userRows = (await qr.query(`SELECT "id","kyc_status" FROM "users" WHERE "id" = $1 LIMIT 1`, [
      req.user!.id,
    ])) as Array<{ id: string; kyc_status: string }>;
    const kycRows = (await qr.query(
      `SELECT * FROM "kyc" WHERE "user_id" = $1 ORDER BY "created_at" DESC LIMIT 1`,
      [req.user!.id],
    )) as Array<Record<string, unknown>>;
    return { user: userRows[0], kyc: kycRows[0] ?? null };
  });

  return ok(res, result);
}

