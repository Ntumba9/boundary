-- Admin audit log and the rate limiter for admin mutations.
-- See src/lib/services/auditLog.ts and src/lib/auth/adminThrottle.ts.

-- Append-only from the application's point of view: the service layer only
-- ever INSERTs here, in the same transaction as the mutation it records.
-- No UPDATE/DELETE path exists in application code.
CREATE TABLE admin_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_user_id   uuid NOT NULL,
  target_user_id  uuid NOT NULL,
  action          text NOT NULL CHECK (action IN ('user_created', 'role_changed', 'active_changed')),
  -- Plain text, not JSON: a role ('admin'/'member') or a boolean-as-text
  -- ('true'/'false'). Never a password, token, or document body.
  old_value       text,
  new_value       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Composite FKs: an actor or target row must belong to the SAME company as
  -- the audit entry, at the database level (mirrors the pattern in 001_init.sql
  -- for documents -> projects/users).
  FOREIGN KEY (actor_user_id, company_id) REFERENCES users (id, company_id),
  FOREIGN KEY (target_user_id, company_id) REFERENCES users (id, company_id)
);
-- Matches the read endpoint's query: tenant filter + keyset order on (created_at, id).
CREATE INDEX admin_audit_log_company_created_idx ON admin_audit_log (company_id, created_at, id);

-- Rate limiting for admin mutations (create user / change role / set active),
-- scoped per (company, actor), not per endpoint: one shared budget across all
-- three. Same atomic-UPSERT shape as login_attempts (see throttle.ts), but a
-- fixed-window request counter rather than a failure-count-then-lock: an
-- admin's own successful actions should still count against their budget.
CREATE TABLE admin_mutation_attempts (
  limit_key     text PRIMARY KEY,
  count         integer NOT NULL DEFAULT 0,
  window_start  timestamptz NOT NULL DEFAULT now()
);
