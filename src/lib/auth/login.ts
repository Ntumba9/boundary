import 'server-only';
import type { NextRequest } from 'next/server';
import { query } from '../db';
import { HttpError, unauthorized } from '../errors';
import { log } from '../log';
import { burnPasswordCheck, verifyPassword } from './password';
import { createSession } from './session';
import { attemptKey, clearFailures, clientIp, isLocked, recordFailure } from './throttle';

interface LoginUserRow {
  id: string;
  company_id: string;
  password_hash: string;
  is_active: boolean;
}

/**
 * Verify credentials and create a session. Every failure mode (unknown email,
 * wrong password, deactivated account) returns the same generic 401 so the
 * response does not reveal which one happened.
 */
export async function login(
  req: NextRequest,
  email: string,
  password: string,
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const key = attemptKey(email, clientIp(req));
  if (await isLocked(key)) {
    log.warn('login_throttled', { email: email.toLowerCase() });
    throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
  }

  const { rows } = await query<LoginUserRow>(
    'SELECT id, company_id, password_hash, is_active FROM users WHERE lower(email) = lower($1)',
    [email.trim()],
  );
  const user = rows[0];

  let ok = false;
  if (user) {
    ok = await verifyPassword(user.password_hash, password);
  } else {
    await burnPasswordCheck(password);
  }

  if (!user || !ok || !user.is_active) {
    await recordFailure(key);
    log.info('login_failed', { email: email.toLowerCase() });
    throw unauthorized('Invalid email or password');
  }

  await clearFailures(key);
  const session = await createSession(user.id);
  log.info('login_succeeded', { userId: user.id, company: user.company_id });
  return session;
}
