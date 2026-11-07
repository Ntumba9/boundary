// Shared helper for the CLI scripts (migrate, seed, test runner reset).
// Destructive scripts refuse to touch anything that is not a local database.

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }
  return url;
}

/** Throws unless DATABASE_URL points at a local host. Used before destructive operations. */
export function requireLocalDatabaseUrl(): string {
  const url = requireDatabaseUrl();
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run a destructive operation against non-local database host "${host}".`,
    );
  }
  return url;
}
