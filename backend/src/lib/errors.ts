export type AppErrorDetails = Record<string, unknown> | undefined;

export class AppError extends Error {
  status: number;
  code: string;
  details?: AppErrorDetails;

  constructor(status: number, code: string, message: string, details?: AppErrorDetails) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: AppErrorDetails) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Sign in to continue.') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

/**
 * Used whenever a feature needs credentials that are not configured.
 * The client shows the setup message instead of a fake success state.
 */
export const notConfigured = (message: string, details?: AppErrorDetails) =>
  new AppError(503, 'NOT_CONFIGURED', message, details);
