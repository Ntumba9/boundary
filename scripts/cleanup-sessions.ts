// Deletes expired session rows and stale login-throttle rows.
// Usage: npm run db:cleanup   (run it periodically, e.g. from cron or a scheduled CI job)
//
// Not a background worker on purpose: expired sessions are already rejected by
// resolveSession() (`expires_at > now()`), so these rows are dead weight, not a
// security problem. Purging them is housekeeping that can run on any schedule.
// Safe to run against any environment's database: it only removes rows that
// the application already ignores, so it does not use the local-only guard.
import pg from 'pg';
import { requireDatabaseUrl } from './db-url.ts';

// Must stay >= WINDOW_MINUTES in src/lib/auth/throttle.ts (15), or a row could
// be deleted while it still counts toward a lockout.
const THROTTLE_RETENTION_MINUTES = 60;

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    // Range scan on sessions_expires_idx (db/migrations/002_indexes.sql).
    const sessions = await client.query('DELETE FROM sessions WHERE expires_at <= now()');
    // A row is stale when its counting window ended long ago and it is not locked.
    const attempts = await client.query(
      `DELETE FROM login_attempts
        WHERE window_start < now() - make_interval(mins => $1)
          AND (locked_until IS NULL OR locked_until < now())`,
      [THROTTLE_RETENTION_MINUTES],
    );
    console.log(
      `deleted ${sessions.rowCount ?? 0} expired sessions, ${attempts.rowCount ?? 0} stale login_attempts rows`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('cleanup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
