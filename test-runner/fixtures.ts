// Explicit test identities and known IDs. These are imported straight from the
// seed definition (scripts/seed-data.ts), so the runner and the database
// always agree. Nothing is "discovered" at runtime.
//
// Fixture isolation: reset() re-runs the seed against the LOCAL database before
// every case group, so groups are independent and runs are repeatable.
import pg from 'pg';
import { requireLocalDatabaseUrl } from '../scripts/db-url.ts';
import { seed } from '../scripts/seed.ts';
import { COMPANIES, DEMO_PASSWORD, DOCUMENTS, PROJECTS, USERS } from '../scripts/seed-data.ts';

export { COMPANIES, DEMO_PASSWORD, DOCUMENTS, PROJECTS, USERS };

/** Password for users the runner creates during a case. Demo value only. */
export const RUNNER_USER_PASSWORD = 'RunnerPassword123!';

/** Wipe and reseed the local database. Refuses non-local DATABASE_URL. */
export async function resetFixtures(): Promise<void> {
  await seed(requireLocalDatabaseUrl());
}

/**
 * Direct DB fixture manipulation for the "deactivated outside the API" case:
 * flips users.is_active WITHOUT deleting sessions, so we can prove the
 * per-request is_active check works on its own. Also reports whether the
 * user still has an unexpired session row (precondition for the case).
 */
export async function deactivateDirectlyInDb(userId: string): Promise<{ unexpiredSessions: number }> {
  const client = new pg.Client({ connectionString: requireLocalDatabaseUrl() });
  await client.connect();
  try {
    await client.query('UPDATE users SET is_active = false WHERE id = $1', [userId]);
    const { rows } = await client.query<{ n: string }>(
      'SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND expires_at > now()',
      [userId],
    );
    return { unexpiredSessions: Number(rows[0]?.n ?? 0) };
  } finally {
    await client.end();
  }
}

let counter = 0;
/** Unique email for users created during a run (lives only until the next reset). */
export function runnerEmail(tag: string, company: 'acme' | 'globex'): string {
  counter += 1;
  return `runner-${tag}-${Date.now()}-${counter}@${company}.example`;
}
