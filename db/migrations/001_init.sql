-- BOUNDARY schema.
--
-- Tenant isolation notes:
--  * Every tenant-owned row (users, projects, documents) carries company_id
--    directly, so every query can filter on it without join chains.
--  * Composite foreign keys (project_id, company_id) and
--    (owner_user_id, company_id) make it impossible at the database level for a
--    document to point at a project or owner from a different company, even if
--    application code had a bug.
--  * sessions holds only a SHA-256 hash of the opaque token plus user_id and
--    expiry. Role and active status are NOT copied into the session; they are
--    read fresh from users on every request.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email          text NOT NULL,
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('admin', 'member')),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, company_id)
);
-- Emails are globally unique (login is by email alone, not email+company).
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));
CREATE INDEX users_company_idx ON users (company_id);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,      -- sha256(hex) of the opaque session token
  csrf_hash   text NOT NULL,             -- sha256(hex) of the CSRF token bound to this session
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, company_id)
);
CREATE INDEX projects_company_idx ON projects (company_id);

CREATE TABLE documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  owner_user_id  uuid NOT NULL,
  title          text NOT NULL,
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, company_id) REFERENCES projects (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, company_id) REFERENCES users (id, company_id)
);
CREATE INDEX documents_company_project_idx ON documents (company_id, project_id);

-- Login throttling (see src/lib/throttle.ts). Keyed by lower(email) + client IP.
CREATE TABLE login_attempts (
  attempt_key    text PRIMARY KEY,
  failed_count   integer NOT NULL DEFAULT 0,
  window_start   timestamptz NOT NULL DEFAULT now(),
  locked_until   timestamptz
);
