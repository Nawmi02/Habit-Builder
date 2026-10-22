/**
 * Error types + a parser for Django REST Framework error bodies.
 *
 * Shapes the backend can return (all verified against the serializers/views):
 *   { "email": ["user with this email already exists."] }          field errors (list)
 *   { "status": "Only pending occurrences can be completed." }     ValidationError({...}) with a plain string
 *   { "schedule": { "weekdays": ["Select at least one weekday."] } } nested serializer
 *   { "non_field_errors": ["..."] }
 *   { "detail": "No active account found with the given credentials" }   simplejwt 401
 *   { "detail": "...", "code": "token_not_valid", "messages": [...] }
 *   a non-JSON body (Django debug HTML page on a 500)
 */

export type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** Flattened: nested keys joined with ".", e.g. "schedule.weekdays". */
  readonly fieldErrors: FieldErrors;
  readonly body: unknown;

  constructor(status: number, message: string, fieldErrors: FieldErrors = {}, code?: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
    this.body = body;
  }

  /** First error message for a field, or undefined. Handy for <Field error={...}/>. */
  field(name: string): string | undefined {
    return this.fieldErrors[name]?.[0];
  }
}

/** The request never got an HTTP answer (offline, DNS, timeout, server down). */
export class NetworkError extends Error {
  readonly timeout: boolean;
  constructor(message = 'Network request failed', timeout = false) {
    super(message);
    this.name = 'NetworkError';
    this.timeout = timeout;
  }
}

function collect(value: unknown, path: string, out: FieldErrors): void {
  if (typeof value === 'string') {
    (out[path] ??= []).push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') (out[path] ??= []).push(item);
      else collect(item, path, out);
    }
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      collect(inner, path ? `${path}.${key}` : key, out);
    }
  }
}

const GENERIC: Record<number, string> = {
  400: 'Please check the information you entered.',
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have permission to do that.',
  404: 'We could not find what you were looking for.',
  405: 'That action is not supported.',
  429: 'Too many attempts. Please wait a moment and try again.',
};

export function parseApiError(status: number, body: unknown): ApiError {
  const fieldErrors: FieldErrors = {};
  let code: string | undefined;
  let detail: string | undefined;

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    if (typeof obj.detail === 'string') detail = obj.detail;
    if (typeof obj.code === 'string') code = obj.code;
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'detail' || key === 'code' || key === 'messages') continue;
      collect(value, key, fieldErrors);
    }
  } else if (Array.isArray(body)) {
    collect(body, 'non_field_errors', fieldErrors);
  } else if (typeof body === 'string' && status < 500 && body.length <= 200 && !body.includes('<')) {
    // a short plain-text error. (Never use HTML / long text - e.g. Django's debug 500 page.)
    collect(body, 'non_field_errors', fieldErrors);
  }

  const firstFieldMessage = Object.values(fieldErrors)[0]?.[0];
  const message =
    detail ??
    fieldErrors.non_field_errors?.[0] ??
    firstFieldMessage ??
    GENERIC[status] ??
    (status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Request failed.');

  return new ApiError(status, message, fieldErrors, code, body);
}

/** One friendly sentence for any error a screen might catch. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof NetworkError) {
    return err.timeout
      ? 'The server took too long to answer. Please try again.'
      : 'Cannot reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}
