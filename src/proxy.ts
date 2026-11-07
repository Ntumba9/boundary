import { NextResponse, type NextRequest } from 'next/server';

// Per-request Content-Security-Policy with a nonce (Next 16 "proxy", formerly
// middleware). Static headers that don't vary per request (nosniff,
// X-Frame-Options, Referrer-Policy, and a locked-down CSP for /api JSON) live
// in next.config.ts.
//
// How the nonce works: Next reads the CSP from the *request* headers during
// server rendering, extracts 'nonce-...', and stamps it on its own bootstrap
// and chunk <script> tags. 'strict-dynamic' then lets those trusted scripts
// load further chunks. An injected <script> or inline handler has no nonce and
// is blocked. This requires every page to be dynamically rendered, which they
// already are here (the root layout reads the session cookie).
//
// Development only: React needs 'unsafe-eval' for its dev tooling, and the dev
// server injects <style> tags without a nonce. Neither relaxation applies to
// `next build && next start` (CI and the Docker image run production mode).

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' ${isDev ? `'unsafe-inline'` : `'nonce-${nonce}'`}`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only. API routes return JSON (static CSP in next.config.ts);
      // static assets don't need a per-request policy.
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      // Router prefetches don't render HTML that executes, so skip the work.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
