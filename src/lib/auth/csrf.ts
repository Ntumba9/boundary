import 'server-only';
import type { NextRequest } from 'next/server';
import { forbidden } from '../errors';
import { CSRF_COOKIE, CSRF_HEADER, safeEqualHex, sha256Hex, type AuthContext } from './session';

/**
 * CSRF defence for cookie-authenticated mutations (POST/PUT/PATCH/DELETE).
 *
 * Double-submit, bound to the session:
 *   - At login the server issues a random CSRF token in a readable (non-HttpOnly)
 *     cookie, and stores sha256(token) on the session row.
 *   - Client code reads the cookie and echoes it in the `x-csrf-token` header.
 *   - Here we require: header present, header === cookie, and
 *     sha256(header) === session.csrf_hash.
 *
 * A cross-site attacker can make the browser SEND our cookies but cannot READ
 * them, so it cannot produce the header. Binding to the session hash also
 * defeats "cookie tossing" (an attacker who can plant a csrf cookie from a
 * sibling subdomain still can't match the server-side hash).
 *
 * SameSite=Lax alone is not treated as sufficient: it still allows top-level
 * cross-site GET navigations, it does not protect against same-site attackers
 * (other apps on a sibling subdomain), and older/embedded browsers differ.
 */
export function verifyCsrf(req: NextRequest, auth: AuthContext): void {
  const header = req.headers.get(CSRF_HEADER) ?? '';
  const cookie = req.cookies.get(CSRF_COOKIE)?.value ?? '';
  if (!header || !cookie) throw forbidden('Missing CSRF token');
  if (!safeEqualHex(header, cookie)) throw forbidden('CSRF token mismatch');
  if (!safeEqualHex(sha256Hex(header), auth.csrfHash)) throw forbidden('CSRF token not valid for this session');
}

/**
 * Extra layer: if the browser sent an Origin header, it must match our host.
 * (Non-browser clients often omit Origin; that's fine because they then also
 * need the CSRF header, which only a same-origin script can read.)
 */
export function verifyOrigin(req: NextRequest): void {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('host');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden('Bad Origin header');
  }
  if (!host || originHost.toLowerCase() !== host.toLowerCase()) {
    throw forbidden('Cross-origin request rejected');
  }
}
