// fetch() wrapper that never auto-follows redirects. Same-origin redirects are
// followed manually (up to MAX_REDIRECTS); a redirect to ANY other origin
// aborts the request, so the runner cannot be bounced to a host that was not
// explicitly configured.
import { MAX_REDIRECTS, REQUEST_TIMEOUT_MS } from './config.ts';

export class CrossOriginRedirectError extends Error {}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  /** A string body is sent with a Content-Length; a stream body goes chunked (no declared length). */
  body?: string | ReadableStream<Uint8Array>;
  /** Return 3xx responses instead of following them (used by UI smoke tests). */
  noFollow?: boolean;
}

export async function safeFetch(targetOrigin: string, url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  let current = new URL(url);
  let method = opts.method ?? 'GET';
  let body = opts.body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.origin !== targetOrigin) {
      throw new CrossOriginRedirectError(`Refusing request to ${current.origin}; target is ${targetOrigin}`);
    }
    // A stream body requires duplex:'half' (undici sends it chunked, with no
    // Content-Length) - that is exactly the transport shape being tested.
    const init = {
      method,
      headers: opts.headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    } as RequestInit;
    const res = await fetch(current, init);
    if (!REDIRECT_STATUSES.has(res.status) || opts.noFollow) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    const next = new URL(location, current);
    if (next.origin !== targetOrigin) {
      throw new CrossOriginRedirectError(`Blocked redirect from ${current.origin} to different origin ${next.origin}`);
    }
    await res.body?.cancel();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== 'GET' && method !== 'HEAD')) {
      method = 'GET';
      body = undefined;
    }
    current = next;
  }
  throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
}
