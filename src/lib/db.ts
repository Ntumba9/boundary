import 'server-only';
import { Pool, type QueryResultRow } from 'pg';
import { log } from './log';

// One pool per server process. In `next dev`, modules are re-evaluated on hot
// reload, so the pool is cached on globalThis to avoid leaking connections.
// src/instrumentation.ts reads the same global to close the pool on shutdown.
const globalForPool = globalThis as unknown as { __boundaryPool?: Pool };

function getPool(): Pool {
  if (!globalForPool.__boundaryPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    const pool = new Pool({
      connectionString,
      // Single Next.js process; 10 is plenty and well under Postgres' default
      // max_connections (100), leaving room for migrations, psql and a second
      // instance during a rolling restart.
      max: 10,
      // Release idle connections after 30s so a quiet server doesn't pin backends.
      idleTimeoutMillis: 30_000,
      // Fail a request fast (-> 500) instead of hanging if the DB is unreachable
      // or the pool is exhausted. pg's default is to wait forever.
      connectionTimeoutMillis: 5_000,
      // Server-side cap per statement. Every query here is a short indexed
      // lookup; anything near this limit is a bug, not a workload.
      statement_timeout: 10_000,
    });
    // An idle client can error (DB restart, network drop). Without a listener
    // that 'error' event is unhandled and crashes the process; the pool already
    // discards the broken client, so logging is all that's needed.
    pool.on('error', (err) => log.error('db_pool_idle_client_error', { message: err.message }));
    globalForPool.__boundaryPool = pool;
  }
  return globalForPool.__boundaryPool;
}

/**
 * Run a parameterized query. Values are ALWAYS passed separately in `params`;
 * never interpolate values into `text`.
 */
export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const result = await getPool().query<T>(text, params as unknown[]);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}
