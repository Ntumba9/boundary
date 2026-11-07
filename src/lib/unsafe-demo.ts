// Guard for the intentional-vulnerability demo mode. No imports, so it is
// unit-testable with node:test.
//
// The demo mode removes the tenant filter from exactly one query (single
// document GET by id, see src/lib/services/documents.ts, getDocumentById).
// It is OFF unless ALL of these hold:
//   1. BOUNDARY_UNSAFE_DEMO_MODE === '1'
//   2. BOUNDARY_ALLOW_UNSAFE === 'local-demo-only'
//   3. NODE_ENV !== 'production'  (so `next build && next start` can never enable it)
//   4. the request's Host header is localhost / 127.0.0.1 / [::1]
//
// It is read from environment variables only. There is no UI or API to turn it
// on. Check 4 is a guard against accidental enablement on a shared dev box, not
// a security boundary (Host is client-supplied); checks 1-3 are the real gate.

export const UNSAFE_ENV_FLAG = 'BOUNDARY_UNSAFE_DEMO_MODE';
export const UNSAFE_ENV_ACK = 'BOUNDARY_ALLOW_UNSAFE';
export const UNSAFE_ACK_VALUE = 'local-demo-only';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

type Env = Record<string, string | undefined>;

/** Env-only part of the check (used by the health endpoint and startup banner). */
export function unsafeDemoRequestedByEnv(env: Env): boolean {
  return (
    env[UNSAFE_ENV_FLAG] === '1' &&
    env[UNSAFE_ENV_ACK] === UNSAFE_ACK_VALUE &&
    env.NODE_ENV !== 'production'
  );
}

export function hostnameFromHostHeader(hostHeader: string | null | undefined): string {
  if (!hostHeader) return '';
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  // A bare IPv6 literal (more than one colon, no brackets) carries no port.
  if (h.split(':').length > 2) return h;
  return h.split(':')[0];
}

export function isUnsafeDemoEnabled(env: Env, hostHeader: string | null | undefined): boolean {
  return unsafeDemoRequestedByEnv(env) && LOCAL_HOSTNAMES.has(hostnameFromHostHeader(hostHeader));
}
