import { NextResponse } from 'next/server';
import { authed } from '@/lib/api';
import { CSRF_COOKIE, deleteSessionByToken, SESSION_COOKIE } from '@/lib/auth/session';

// Logout is a mutation, so it goes through the same CSRF check as everything else.
export const POST = authed(async ({ req }) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await deleteSessionByToken(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(CSRF_COOKIE);
  return res;
});
