import 'server-only';
import type { NextRequest } from 'next/server';
import { query } from '../db';

/**
 * Basic login throttling, stored in the `login_attempts` table.
 *
 * Key: lower(email) + "|" + client IP. After MAX_FAILURES failed attempts
 * within WINDOW_MINUTES, the key is locked for LOCK_MINUTES; attempts during
 * the lock get 429 without checking the password.
 *
 * Known limitations (this is a demo, not production-grade):
 *  - Client IP comes from X-Forwarded-For only if TRUST_PROXY_HEADERS=1;
 *    otherwise all clients share the IP bucket "direct", which makes the lock
 *    effectively per-email. A per-email lock lets an attacker lock a victim out
 *    for LOCK_MINUTES (accepted trade-off at this scale).
 *  - No global/per-IP rate limit across many emails (credential stuffing).
 *  - Single database; no distributed counters.
 */
export const MAX_FAILURES = 5;
export const WINDOW_MINUTES = 15;
export const LOCK_MINUTES = 5;

export function clientIp(req: NextRequest): string {
  if (process.env.TRUST_PROXY_HEADERS === '1') {
    const xff = req.headers.get('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim().slice(0, 64);
  }
  return 'direct';
}

export function attemptKey(email: string, ip: string): string {
  return `${email.trim().toLowerCase()}|${ip}`;
}

export async function isLocked(key: string): Promise<boolean> {
  const { rows } = await query<{ locked: boolean }>(
    'SELECT (locked_until IS NOT NULL AND locked_until > now()) AS locked FROM login_attempts WHERE attempt_key = $1',
    [key],
  );
  return rows[0]?.locked ?? false;
}

export async function recordFailure(key: string): Promise<void> {
  const { rows } = await query<{ failed_count: number }>(
    `INSERT INTO login_attempts (attempt_key, failed_count, window_start)
     VALUES ($1, 1, now())
     ON CONFLICT (attempt_key) DO UPDATE SET
       failed_count = CASE WHEN login_attempts.window_start < now() - make_interval(mins => $2)
                           THEN 1 ELSE login_attempts.failed_count + 1 END,
       window_start = CASE WHEN login_attempts.window_start < now() - make_interval(mins => $2)
                           THEN now() ELSE login_attempts.window_start END
     RETURNING failed_count`,
    [key, WINDOW_MINUTES],
  );
  if ((rows[0]?.failed_count ?? 0) >= MAX_FAILURES) {
    await query(
      `UPDATE login_attempts
          SET locked_until = now() + make_interval(mins => $2), failed_count = 0, window_start = now()
        WHERE attempt_key = $1`,
      [key, LOCK_MINUTES],
    );
  }
}

export async function clearFailures(key: string): Promise<void> {
  await query('DELETE FROM login_attempts WHERE attempt_key = $1', [key]);
}
