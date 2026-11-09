export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PRICE_CHANGED'
  | 'SOLD_OUT'
  | 'INVALID_STATE_TRANSITION'
  | 'PAYMENT_FAILED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  PRICE_CHANGED: 409,
  SOLD_OUT: 409,
  INVALID_STATE_TRANSITION: 409,
  PAYMENT_FAILED: 402,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

export const Errors = {
  validation: (details: unknown, message = 'Request validation failed') =>
    new AppError('VALIDATION_FAILED', message, details),
  unauthenticated: (message = 'Authentication required') => new AppError('UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError('FORBIDDEN', message),
  notFound: (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`),
  conflict: (message: string, details?: unknown) => new AppError('CONFLICT', message, details),
  soldOut: (message = 'Not enough availability for the selected dates') =>
    new AppError('SOLD_OUT', message),
  invalidTransition: (from: string, to: string) =>
    new AppError('INVALID_STATE_TRANSITION', `Cannot move from ${from} to ${to}`),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError('RATE_LIMITED', 'Too many requests', { retryAfterSeconds }),
};
