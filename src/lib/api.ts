import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { verifyCsrf, verifyOrigin } from './auth/csrf';
import { resolveSession, SESSION_COOKIE, type AuthContext } from './auth/session';
import { HttpError } from './errors';
import { log } from './log';

/**
 * Wrapper for every authenticated route handler.
 *
 * The handler receives `auth`, which is derived ONLY from the session cookie
 * plus a fresh database read. Handlers must take userId/companyId/role from
 * `auth`, never from the request body, query string, or headers.
 *
 * Order of checks:  session (401)  ->  origin + CSRF for mutations (403)  ->  handler.
 */
export function authed<P extends Record<string, string> = Record<string, never>>(
  handler: (args: { req: NextRequest; auth: AuthContext; params: P }) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      const auth = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
      if (isMutation(req.method)) {
        verifyOrigin(req);
        verifyCsrf(req, auth);
      }
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await handler({ req, auth, params });
    } catch (err) {
      return errorResponse(err, req);
    }
  };
}

/** Wrapper for unauthenticated handlers (login, health) so errors are handled uniformly. */
export function publicRoute(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      if (isMutation(req.method)) verifyOrigin(req);
      return await handler(req);
    } catch (err) {
      return errorResponse(err, req);
    }
  };
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

/**
 * Parse and validate a JSON body against a zod schema.
 * Schemas are `.strict()`, so unknown keys such as company_id, owner_user_id
 * or role are REJECTED with 400 rather than silently accepted (mass-assignment
 * protection). Only whitelisted fields ever reach SQL.
 */
export async function parseJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
  return schema.parse(raw);
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

function errorResponse(err: unknown, req: NextRequest): Response {
  if (err instanceof HttpError) {
    if (err.status >= 500) log.error('request_failed', { path: req.nextUrl.pathname, status: err.status });
    return NextResponse.json(
      { error: err.message, ...(err.details ? { details: err.details } : {}) },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  }
  log.error('unhandled_error', { path: req.nextUrl.pathname, method: req.method, err });
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
