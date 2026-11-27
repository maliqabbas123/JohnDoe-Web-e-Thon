// The one error type services and handlers throw on purpose. Anything else
// that reaches the route wrapper is treated as unexpected and hidden.
export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL";

export type FieldError = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: FieldError[],
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const errors = {
  badRequest: (message = "The request could not be understood.") =>
    new ApiError(400, "BAD_REQUEST", message),
  unauthenticated: (message = "Sign in to continue.") =>
    new ApiError(401, "UNAUTHENTICATED", message),
  forbidden: (message = "You do not have permission to do this.") =>
    new ApiError(403, "FORBIDDEN", message),
  notFound: (message = "Not found.") => new ApiError(404, "NOT_FOUND", message),
  conflict: (message: string) => new ApiError(409, "CONFLICT", message),
  payloadTooLarge: (message = "The request is too large.") =>
    new ApiError(413, "PAYLOAD_TOO_LARGE", message),
  validation: (details: FieldError[], message = "Some fields are invalid.") =>
    new ApiError(422, "VALIDATION_FAILED", message, details),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, "RATE_LIMITED", "Too many requests. Try again later.", undefined, {
      "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))),
    }),
};
