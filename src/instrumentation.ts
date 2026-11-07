import { UNSAFE_ENV_ACK, UNSAFE_ENV_FLAG, unsafeDemoRequestedByEnv } from './lib/unsafe-demo';

// Runs once at server start. Makes the demo-mode state impossible to miss in
// the server log, including the case where it was requested but refused.
export function register(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  registerPoolShutdown();
  const requested = process.env[UNSAFE_ENV_FLAG] === '1' || process.env[UNSAFE_ENV_ACK] !== undefined;
  if (unsafeDemoRequestedByEnv(process.env)) {
    console.warn(
      '[boundary] WARNING: UNSAFE DEMO MODE ENABLED (localhost requests only). ' +
        'GET /api/documents/:id skips the tenant filter. Never run this anywhere but your own machine.',
    );
  } else if (requested) {
    console.warn(
      `[boundary] Unsafe demo mode requested but NOT enabled: requires ${UNSAFE_ENV_FLAG}=1, ` +
        `${UNSAFE_ENV_ACK}=local-demo-only and NODE_ENV !== 'production'.`,
    );
  }
}

// Close the pg pool on SIGTERM/SIGINT so Postgres sees clean disconnects
// instead of reset sockets (e.g. on `docker stop`).
//
// Next's own handler (next start / standalone server.js) also listens for
// these signals: it stops accepting connections, waits for in-flight requests,
// then calls process.exit(). Both listeners run, in no guaranteed order with
// respect to the drain. pool.end() lets queries already running finish. The
// global is cleared first, so a request still in flight that issues another
// query lazily opens a fresh pool instead of failing on an ended one; that
// rare pool is torn down by process exit. A service that must close every
// connection cleanly would take over signal handling (NEXT_MANUAL_SIG_HANDLE),
// drain HTTP itself, and only then end the pool. Not worth it for a demo.
//
// The pool is read from the global that src/lib/db.ts caches it on, rather
// than importing db.ts (which is 'server-only' and would create a pool here).
function registerPoolShutdown(): void {
  const g = globalThis as unknown as {
    __boundaryPool?: { end(): Promise<void> };
    __boundaryShutdownRegistered?: boolean;
  };
  if (g.__boundaryShutdownRegistered) return;
  g.__boundaryShutdownRegistered = true;

  const close = (signal: string) => {
    const pool = g.__boundaryPool;
    if (!pool) return;
    g.__boundaryPool = undefined;
    pool.end().then(
      () => console.log(`[boundary] ${signal}: database pool closed`),
      (err: unknown) => console.error(`[boundary] ${signal}: error closing database pool`, err),
    );
  };
  process.once('SIGTERM', () => close('SIGTERM'));
  process.once('SIGINT', () => close('SIGINT'));
}
