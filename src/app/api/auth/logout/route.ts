import { NextResponse } from 'next/server';
import { publicRoute } from '@/lib/api';
import { verifyCsrf } from '@/lib/auth/csrf';
import { CSRF_COOKIE, deleteSessionByToken, resolveSession, SESSION_COOKIE } from '@/lib/auth/session';
import { HttpError } from '@/lib/errors';

// Logout must always work, even when the session has already expired or the
// account was deactivated: there is nothing left to protect server-side, so
// the cookies are cleared regardless. With a live session the full CSRF check
// still applies; publicRoute keeps the Origin check in every case.
export const POST = publicRoute(async (req) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  try {
    const auth = await resolveSession(token);
    // Live session: same CSRF requirement as every other mutation.
    verifyCsrf(req, auth);
  } catch (err) {
    // Only a missing/invalid/expired session (401) is allowed through: the
    // session is gone server-side, so clearing the cookies is all that
    // remains. A CSRF failure on a LIVE session (403) and real errors
    // (e.g. database down) still fail the request.
    if (!(err instanceof HttpError && err.status === 401)) throw err;
  }
  if (token && /^[a-f0-9]{64}$/.test(token)) await deleteSessionByToken(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(CSRF_COOKIE);
  return res;
});
