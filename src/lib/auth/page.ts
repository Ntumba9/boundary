import 'server-only';
import { cookies } from 'next/headers';
import { forbidden, notFound, redirect } from 'next/navigation';
import { HttpError } from '../errors';
import { resolveSession, SESSION_COOKIE, type AuthContext } from './session';

/** For server components: the current caller, or null if not authenticated. */
export async function getPageAuth(): Promise<AuthContext | null> {
  const store = await cookies();
  try {
    return await resolveSession(store.get(SESSION_COOKIE)?.value);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) return null;
    throw err;
  }
}

/** For server components: the current caller, or redirect to /login. */
export async function requirePageAuth(): Promise<AuthContext> {
  const auth = await getPageAuth();
  if (!auth) redirect('/login');
  return auth;
}

/**
 * Run a service call from a page and map service errors to Next's 404/403
 * pages, so pages obey the same status-code policy as the API.
 */
export async function pageCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 404) notFound();
      if (err.status === 403) forbidden();
      if (err.status === 401) redirect('/login');
    }
    throw err;
  }
}
