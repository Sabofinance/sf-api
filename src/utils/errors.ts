export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = 'Authentication required. Include a valid Bearer access token in the Authorization header.',
    code = 'UNAUTHORIZED',
  ) {
    super(code, message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.', code = 'FORBIDDEN') {
    super(code, message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.', code = 'NOT_FOUND') {
    super(code, message, 404);
  }
}
