'use client';

// Browser-side helper for calling our own API. All UI mutations go through the
// same route handlers the test runner exercises, so there is exactly one
// enforcement path. The CSRF token is read from its (non-HttpOnly) cookie and
// echoed in the x-csrf-token header.

function readCookie(name: string): string {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const c = part.trim();
    if (c.startsWith(prefix)) return decodeURIComponent(c.slice(prefix.length));
  }
  return '';
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = readCookie('boundary_csrf');
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    redirect: 'error',
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const error =
    res.ok
      ? null
      : (data as { error?: string; issues?: { message: string }[] } | null)?.issues?.[0]?.message ??
        (data as { error?: string } | null)?.error ??
        `Request failed (${res.status})`;
  return { ok: res.ok, status: res.status, data: res.ok ? (data as T) : null, error };
}
