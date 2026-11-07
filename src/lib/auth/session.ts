import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { query } from '../db';
import { unauthorized } from '../errors';
import { isRole, type Role } from '../permissions';

export const SESSION_COOKIE = 'boundary_session';
export const CSRF_COOKIE = 'boundary_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Everything a request handler is allowed to know about the caller.
 * Built fresh from the database on every request; never from client input,
 * and never from data cached in the session row or a signed token.
 */
export interface AuthContext {
  sessionId: string;
  userId: string;
  companyId: string;
  companyName: string;
  email: string;
  role: Role;
  /** sha256 of the CSRF token bound to this session (for verification only). */
  csrfHash: string;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Cookie `Secure` flag: on in production unless explicitly disabled for plain-http local testing. */
export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  return process.env.NODE_ENV === 'production';
}

export async function createSession(
  userId: string,
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = newOpaqueToken();
  const csrfToken = newOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  // Only hashes are stored. A database leak does not yield usable session cookies.
  await query(
    'INSERT INTO sessions (user_id, token_hash, csrf_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, sha256Hex(token), sha256Hex(csrfToken), expiresAt],
  );
  return { token, csrfToken, expiresAt };
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [sha256Hex(token)]);
}

interface SessionRow {
  session_id: string;
  user_id: string;
  company_id: string;
  company_name: string;
  email: string;
  role: string;
  is_active: boolean;
  csrf_hash: string;
}

/**
 * Resolve a raw session token to the caller's CURRENT identity.
 * Role and is_active come from `users` on every call, so a role change or a
 * deactivation takes effect on the very next request, with no re-login.
 * Throws 401 if the token is missing, unknown, expired, or the user is inactive.
 */
export async function resolveSession(token: string | undefined | null): Promise<AuthContext> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw unauthorized();
  const { rows } = await query<SessionRow>(
    `SELECT s.id AS session_id, s.csrf_hash, u.id AS user_id, u.company_id, c.name AS company_name,
            u.email, u.role, u.is_active
       FROM sessions s
       JOIN users u     ON u.id = s.user_id
       JOIN companies c ON c.id = u.company_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()`,
    [sha256Hex(token)],
  );
  const row = rows[0];
  if (!row) throw unauthorized();
  if (!row.is_active) throw unauthorized('Account is deactivated');
  if (!isRole(row.role)) throw unauthorized();
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    companyId: row.company_id,
    companyName: row.company_name,
    email: row.email,
    role: row.role,
    csrfHash: row.csrf_hash,
  };
}
