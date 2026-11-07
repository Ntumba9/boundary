// Test runner target configuration.
//
// The runner only ever talks to a local BOUNDARY instance by default. To point
// it at any other host you must BOTH add that exact hostname to
// AUTHORIZED_REMOTE_HOSTS below (a code change, reviewable in a PR) AND pass
// --i-am-authorized on the command line. Only do this for systems you own or
// have written permission to test.

export const DEFAULT_BASE_URL = 'http://localhost:3000';

/** Always permitted: loopback only. */
export const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** Explicit allowlist for non-local targets. Empty by design. Example: 'staging.boundary.internal' */
export const AUTHORIZED_REMOTE_HOSTS: readonly string[] = [];

export const MAX_REDIRECTS = 5;
export const REQUEST_TIMEOUT_MS = 15_000;

export type TargetCheck =
  | { ok: true; url: URL; isLocal: boolean }
  | { ok: false; reason: string };

export function checkTarget(rawUrl: string, iAmAuthorized: boolean): TargetCheck {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `Not a valid URL: ${rawUrl}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Only http/https targets are supported (got ${url.protocol})` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Credentials in the target URL are not allowed' };
  }
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTS.includes(host)) return { ok: true, url, isLocal: true };
  if (!AUTHORIZED_REMOTE_HOSTS.includes(host)) {
    return {
      ok: false,
      reason: `Host "${host}" is not in AUTHORIZED_REMOTE_HOSTS (test-runner/config.ts). Refusing to run.`,
    };
  }
  if (!iAmAuthorized) {
    return { ok: false, reason: `Host "${host}" is allowlisted, but --i-am-authorized was not passed. Refusing to run.` };
  }
  return { ok: true, url, isLocal: false };
}
