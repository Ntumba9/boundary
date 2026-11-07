import 'server-only';
import { query } from '../db';

/**
 * Rate limiting for admin mutations (create user, change role, set active),
 * stored in `admin_mutation_attempts`.
 *
 * Key: company_id + ":" + actor user id. One shared budget per admin, across
 * all three mutation types, not per-endpoint: MAX_MUTATIONS attempts per
 * WINDOW_MINUTES, including attempts that go on to fail for some other
 * reason (bad target id, duplicate email). A member can never consume an
 * admin's budget: permission is checked before this, so only a caller who is
 * already an admin reaches it.
 *
 * This is a plain fixed-window counter, not the lockout shape in
 * src/lib/auth/throttle.ts: a login lockout counts *failures* and then
 * blocks for a cooldown, because the goal is to stop password guessing.
 * Here every attempt (successful or not) should count against the window,
 * because the goal is to cap the rate of admin mutations, period.
 *
 * Known limitation (demo, not production-grade): a single shared budget
 * across create/role/active means a legitimate burst of user creation also
 * eats into role-change headroom for the rest of the window. Splitting the
 * budget per action type would be the next step for a real deployment.
 */
export const MAX_ADMIN_MUTATIONS = 10;
export const ADMIN_WINDOW_MINUTES = 1;

export function adminMutationKey(companyId: string, actorUserId: string): string {
  return `${companyId}:${actorUserId}`;
}

/**
 * Atomically count one attempt against `key` and report whether it is still
 * within the limit for the current window.
 *
 * Single statement, same reasoning as the atomic rewrite of recordFailure():
 * the ON CONFLICT clause takes a row lock on the limit_key row, so concurrent
 * callers serialize on it. The count and the window-expiry decision happen in
 * the same atomic step, so parallel requests cannot all read a pre-increment
 * count and all decide they are under the limit (the race the old two-step
 * login-throttle code had).
 */
export async function tryConsumeAdminMutation(key: string): Promise<boolean> {
  const { rows } = await query<{ count: number }>(
    `INSERT INTO admin_mutation_attempts (limit_key, count, window_start)
     VALUES ($1, 1, now())
     ON CONFLICT (limit_key) DO UPDATE SET
       count = CASE
         WHEN admin_mutation_attempts.window_start < now() - make_interval(mins => $2) THEN 1
         ELSE admin_mutation_attempts.count + 1 END,
       window_start = CASE
         WHEN admin_mutation_attempts.window_start < now() - make_interval(mins => $2) THEN now()
         ELSE admin_mutation_attempts.window_start END
     RETURNING count`,
    [key, ADMIN_WINDOW_MINUTES],
  );
  return (rows[0]?.count ?? 0) <= MAX_ADMIN_MUTATIONS;
}
