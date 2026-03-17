import type { Response } from 'express';

export type ApiErrorBody = {
  code: string;
  message: string;
};

export function ok<T>(res: Response, data: T, meta: Record<string, unknown> = {}) {
  return res.status(200).json({
    success: true,
    data,
    meta,
    error: null,
  });
}

export function created<T>(res: Response, data: T, meta: Record<string, unknown> = {}) {
  return res.status(201).json({
    success: true,
    data,
    meta,
    error: null,
  });
}

export function fail(res: Response, status: number, error: ApiErrorBody) {
  return res.status(status).json({
    success: false,
    data: null,
    error,
  });
}

