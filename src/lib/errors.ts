// HTTP-shaped errors thrown by the service layer and translated to responses
// by src/lib/api.ts. The status-code policy is:
//   401  no session, expired session, or deactivated user
//   403  same company, but forbidden by role / ownership / CSRF
//   404  not found OR belongs to another company (never reveal existence)
//   400  validation failure
//   429  login throttled

export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const unauthorized = (msg = 'Authentication required') => new HttpError(401, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const badRequest = (msg = 'Invalid request', details?: unknown) => new HttpError(400, msg, details);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path ids that are not UUIDs can't match any row: treat them as 404, not 500. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
