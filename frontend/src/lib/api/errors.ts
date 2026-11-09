/** A failed API call, carrying the backend's error envelope so forms can map `details` onto fields. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** Per-field messages from a 422 (`details: [{ path, message }]`). */
  get fieldErrors(): Record<string, string> {
    if (this.code !== "VALIDATION_FAILED" || !Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as { path?: string; message?: string }[]).filter((d) => d.path && d.message).map((d) => [d.path!, d.message!]));
  }
  get isUnauthenticated() { return this.status === 401; }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/** Friendly text for any thrown thing. Never leaks internals; the request id helps support. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (isApiError(e)) {
    if (e.code === "RATE_LIMITED") return "Too many attempts. Please wait a moment and try again.";
    if (e.status >= 500 || e.code === "DEPENDENCY_UNAVAILABLE") return "We're having trouble right now. Please try again shortly.";
    return e.message || fallback;
  }
  if (e instanceof TypeError) return "Can't reach the server. Check your connection and try again.";
  return fallback;
}
