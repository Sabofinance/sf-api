import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { captureException } from '../config/sentry';
import { fail } from '../utils/apiResponse';
import { AppError } from '../utils/errors';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ');
    return fail(res, 400, { code: 'VALIDATION_ERROR', message: details || 'Invalid input' });
  }

  if (err instanceof AppError) {
    return fail(res, err.status, { code: err.code, message: err.message });
  }

  const known = err as { name?: string; message?: string; code?: string; detail?: string; constraint?: string };
  if (known?.name === 'TokenExpiredError') {
    return fail(res, 401, { code: 'TOKEN_EXPIRED', message: 'Authentication token has expired. Please log in again.' });
  }
  if (known?.name === 'JsonWebTokenError' || known?.name === 'NotBeforeError') {
    return fail(res, 401, { code: 'INVALID_TOKEN', message: 'Authentication token is invalid.' });
  }

  if (known?.code === '23505') {
    return fail(res, 409, { code: 'DUPLICATE_RESOURCE', message: known.detail || 'This record already exists.' });
  }
  if (known?.code === '23503') {
    return fail(res, 409, { code: 'REFERENCE_CONSTRAINT_ERROR', message: known.detail || 'This record is still referenced by other resources.' });
  }
  if (known?.code === '23502') {
    return fail(res, 400, { code: 'MISSING_REQUIRED_FIELD', message: known.detail || 'A required field is missing.' });
  }
  if (known?.code === '23514') {
    return fail(res, 400, { code: 'INVALID_STATE', message: known.detail || 'Request violates a business rule.' });
  }
  if (known?.code === '22P02') {
    return fail(res, 400, { code: 'INVALID_FORMAT', message: known.detail || 'One or more request values have invalid format.' });
  }

  if (known?.name === 'Error' && typeof known?.message === 'string' && known.message.includes('Invalid image')) {
    return fail(res, 400, {
      code: 'INVALID_IMAGE_UPLOAD',
      message: 'The uploaded file could not be processed as a valid image. Use a standard PNG or JPEG.',
    });
  }

  captureException(err);

  // eslint-disable-next-line no-console
  console.error('Unhandled error:', {
    path: _req.path,
    method: _req.method,
    message: known?.message,
    code: known?.code,
    name: known?.name,
    constraint: known?.constraint,
  });
  return fail(res, 500, { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred. Please try again later.' });
}
