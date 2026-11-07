import { NextResponse } from 'next/server';
import { parseJson, publicRoute } from '@/lib/api';
import { login } from '@/lib/auth/login';
import { cookieSecure, CSRF_COOKIE, SESSION_COOKIE } from '@/lib/auth/session';
import { loginSchema } from '@/lib/validation';

export const POST = publicRoute(async (req) => {
  const { email, password } = await parseJson(req, loginSchema);
  const { token, csrfToken, expiresAt } = await login(req, email, password);

  const res = NextResponse.json({ ok: true });
  const secure = cookieSecure();
  // Session cookie: HttpOnly so page scripts (and any XSS) cannot read it.
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', expires: expiresAt });
  // CSRF cookie: deliberately readable by our own JS so it can be echoed in a header.
  res.cookies.set(CSRF_COOKIE, csrfToken, { httpOnly: false, sameSite: 'lax', secure, path: '/', expires: expiresAt });
  return res;
});
