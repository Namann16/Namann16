import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config/env.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, message);

/** Wrap an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { message: `No route matches ${req.method} ${req.path}.` } });
}

/**
 * Central error handler.
 *
 * Validation failures are returned as a field-keyed list so the UI can point at the offending
 * input. Stack traces are never returned outside development.
 */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        message: 'The data supplied did not pass validation.',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { message: error.message, details: error.details } });
    return;
  }

  const err = error as Error & { status?: number };
  const status = typeof err.status === 'number' ? err.status : 500;

  if (status >= 500) console.error('[error]', err);

  res.status(status).json({
    error: {
      message: status >= 500 && config.isProduction ? 'An unexpected error occurred.' : err.message || 'Unknown error',
      ...(config.isProduction ? {} : { stack: err.stack }),
    },
  });
}
