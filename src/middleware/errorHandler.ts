import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { fail } from '../utils/apiResponse';
import { AppError } from '../utils/errors';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return fail(res, 400, { code: 'VALIDATION_ERROR', message: err.issues[0]?.message ?? 'Invalid input' });
  }

  if (err instanceof AppError) {
    return fail(res, err.status, { code: err.code, message: err.message });
  }

  // eslint-disable-next-line no-console
  console.error(err);
  return fail(res, 500, { code: 'INTERNAL_ERROR', message: 'Unexpected server error' });
}

