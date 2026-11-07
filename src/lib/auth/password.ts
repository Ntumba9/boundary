import 'server-only';
import { hash, verify } from '@node-rs/argon2';

// argon2id via @node-rs/argon2 (prebuilt native binaries, no node-gyp).
// Library defaults are argon2id, m=19456 KiB, t=2, p=1, which matches the
// OWASP Password Storage Cheat Sheet minimum recommendation.

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: string | undefined;

/**
 * Used when the email doesn't exist, so the response time for "unknown email"
 * is similar to "wrong password" (reduces user-enumeration via timing).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  // Cache the resolved hash, not the promise: a one-off hash failure must not
  // poison every later unknown-email login with a permanently rejected promise.
  dummyHash ??= await hash('boundary-timing-equalizer-not-a-real-password');
  await verifyPassword(dummyHash, password);
}
