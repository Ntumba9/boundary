// Wipes all application data and re-inserts the fixed demo dataset.
// Destructive by design; refuses to run against a non-local database.
// Usage: npm run db:seed   (also called by the test runner's reset step)
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { requireLocalDatabaseUrl } from './db-url.ts';
import { COMPANIES, DEMO_PASSWORD, DOCUMENTS, PROJECTS, USERS } from './seed-data.ts';

export async function seed(connectionString: string = requireLocalDatabaseUrl()): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // One hash reused for all demo users keeps reseeding fast (argon2id is
    // intentionally slow). Each hash still has its own salt in real signups.
    const passwordHash = await hash(DEMO_PASSWORD);

    await client.query('BEGIN');
    await client.query('TRUNCATE login_attempts, sessions, documents, projects, users, companies CASCADE');

    for (const c of Object.values(COMPANIES)) {
      await client.query('INSERT INTO companies (id, name) VALUES ($1, $2)', [c.id, c.name]);
    }
    for (const u of Object.values(USERS)) {
      await client.query(
        'INSERT INTO users (id, company_id, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, $5, true)',
        [u.id, u.companyId, u.email, passwordHash, u.role],
      );
    }
    for (const p of Object.values(PROJECTS)) {
      await client.query('INSERT INTO projects (id, company_id, name) VALUES ($1, $2, $3)', [
        p.id,
        p.companyId,
        p.name,
      ]);
    }
    for (const d of Object.values(DOCUMENTS)) {
      await client.query(
        `INSERT INTO documents (id, project_id, company_id, owner_user_id, title, body)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [d.id, d.projectId, d.companyId, d.ownerUserId, d.title, d.body],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

// Run directly: `node scripts/seed.ts`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .then(() => {
      console.log(
        `seeded ${Object.keys(COMPANIES).length} companies, ${Object.keys(USERS).length} users, ` +
          `${Object.keys(PROJECTS).length} projects, ${Object.keys(DOCUMENTS).length} documents`,
      );
    })
    .catch((err: unknown) => {
      console.error('seed failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
