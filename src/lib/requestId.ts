import { randomUUID } from 'node:crypto';

// An incoming X-Request-ID is client-supplied and therefore untrusted: it is
// bounded and validated against a safe character set before it is ever
// reused, logged, or echoed back. A missing or invalid value gets a fresh
// server-generated id instead of being rejected, so the id is always usable
// for correlation even when the caller sent nothing (or sent garbage).
//
// Disallowing everything but this set rules out header/log injection
// (no CR/LF or other control characters) and keeps the value short enough
// that it can't be used to smuggle data through logs or headers.
//
// No imports beyond node:crypto, so this is unit-testable directly.
const MAX_LEN = 128;
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;

export function resolveRequestId(incoming: string | null): string {
  if (incoming !== null && incoming.length > 0 && incoming.length <= MAX_LEN && SAFE_ID_RE.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}
