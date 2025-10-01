export class CallerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export function unauthorized(message: string = 'Unauthorized'): CallerError {
  return new CallerError(message, 'UNAUTHORIZED', 401);
}

export function forbidden(message: string = 'Forbidden'): CallerError {
  return new CallerError(message, 'FORBIDDEN', 403);
}

export function badRequest(message: string = 'Bad Request'): CallerError {
  return new CallerError(message, 'BAD_REQUEST', 400);
}

export function internalError(message: string = 'Internal Error'): CallerError {
  return new CallerError(message, 'INTERNAL_ERROR', 500);
}
