-- Indexes shaped to the actual queries in src/lib/services/* and src/lib/auth/*.
-- See README "Performance notes" for the query each one serves.
--
-- 001_init.sql already covers:
--   users (lower(email)) UNIQUE     login lookup:  WHERE lower(email) = lower($1)
--   sessions (token_hash) UNIQUE    resolveSession: WHERE token_hash = $1
--   sessions (user_id)              deactivation:  DELETE FROM sessions WHERE user_id = $1
--
-- Plain CREATE INDEX (not CONCURRENTLY) because scripts/migrate.ts runs each
-- file inside a transaction, and CONCURRENTLY cannot run in one. On a large
-- live table you would run CONCURRENTLY outside a transaction instead, since
-- plain CREATE INDEX blocks writes to the table while it builds.

-- Documents in a project, keyset-paginated:
--   WHERE project_id = $1 AND company_id = $2 AND (created_at, id) > ($3, $4)
--   ORDER BY created_at, id LIMIT n
-- Equality columns first, then the sort key, so Postgres reads the page
-- straight off the index with no sort step. The two leading columns also serve
-- the per-project document_count subquery and the composite FK
-- (project_id, company_id) -> projects used by ON DELETE CASCADE.
-- This supersedes documents_company_project_idx (same leading columns).
CREATE INDEX documents_tenant_project_page_idx
  ON documents (company_id, project_id, created_at, id);
DROP INDEX documents_company_project_idx;

-- Referencing side of the composite FK (owner_user_id, company_id) -> users.
-- Postgres indexes the referenced side automatically but never the
-- referencing side, so without this any DELETE or key change on users (and
-- the company-level cascade) has to scan every document.
CREATE INDEX documents_owner_idx ON documents (owner_user_id, company_id);

-- Admin user list, keyset-paginated:
--   WHERE company_id = $1 AND (created_at, id) > ($2, $3) ORDER BY created_at, id LIMIT n
-- Supersedes users_company_idx (same leading column).
CREATE INDEX users_tenant_page_idx ON users (company_id, created_at, id);
DROP INDEX users_company_idx;

-- Dashboard project list: WHERE company_id = $1 ORDER BY name.
-- Supersedes projects_company_idx (same leading column).
CREATE INDEX projects_tenant_name_idx ON projects (company_id, name);
DROP INDEX projects_company_idx;

-- Expired-session cleanup: DELETE FROM sessions WHERE expires_at <= now()
-- (scripts/cleanup-sessions.ts). Turns the periodic purge into a range scan
-- instead of a full scan of every live session.
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
