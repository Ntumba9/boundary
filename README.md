# BOUNDARY

A small multi-tenant document app built to show **tenant isolation and role-based access control done carefully**, plus a test runner that proves it, and a deliberate, switchable vulnerability that the runner catches.

> **Disclaimer.** This is a demonstration project. It is not production-hardened and comes with no security guarantee. The threat model below lists what it does and does not try to handle.

---

## Contents

- [Quick start](#quick-start)
- [Running in Docker](#running-in-docker)
- [Architecture](#architecture)
- [Performance notes](#performance-notes)
- [Permission matrix](#permission-matrix)
- [Security controls](#security-controls)
- [Threat model](#threat-model)
- [Test runner](#test-runner)
- [Vulnerability demo: break, detect, fix, pass](#vulnerability-demo-break-detect-fix-pass)
- [CI](#ci)
- [Adapting the runner to another API](#adapting-the-runner-to-another-api)
- [Dependencies](#dependencies)
- [What is covered by tests, honestly](#what-is-covered-by-tests-honestly)
- [Development](#development)
- [Known limitations](#known-limitations)
- [License](#license)

---

## Quick start

Requirements: Node.js **22.18 or newer** (the CLI scripts are TypeScript run directly by Node's built-in type stripping, so there is no `tsx`/`ts-node`), and Docker.

```bash
npm install
cp .env.example .env          # local DB URL; throwaway demo credentials
npm run db:up                 # docker compose up -d --wait  (Postgres on localhost:5440)
npm run db:migrate            # applies db/migrations/*.sql
npm run db:seed               # wipes and reseeds the two demo companies
npm run dev                   # http://localhost:3000
```

Postgres is published on **5440** (not 5432) so it doesn't fight with a locally installed Postgres. Change it with `BOUNDARY_DB_PORT` and update `DATABASE_URL` to match.

### Demo accounts

All four use the published demo password **`Password123!`** (defined in `scripts/seed-data.ts`). It's a demo value. Never reuse it for a real account.

| Company    | Email                   | Role   |
|------------|-------------------------|--------|
| Acme Corp  | `admin@acme.example`    | admin  |
| Acme Corp  | `member@acme.example`   | member |
| Globex Inc | `admin@globex.example`  | admin  |
| Globex Inc | `member@globex.example` | member |

Seed data: Acme has 3 projects / 7 documents, Globex has 2 projects / 5 documents. IDs are fixed UUIDs (see `scripts/seed-data.ts`) so tests are reproducible. Fixed, guessable IDs are deliberate: **unguessable IDs are not access control**. The tenant filter in SQL is.

### Run the tests against the running dev server

```bash
npm run test:authz            # authorization runner, safe mode: expect 57/57 PASS, exit 0
npm run test:smoke            # UI smoke tests (server-rendered HTML checks)
npm run test:e2e              # Playwright browser tests (one-time: npx playwright install chromium)
npm run test:unit             # pure unit tests, no server needed
```

Then open http://localhost:3000/results to see the latest runner output as a table.

If your app is not on port 3000, pass `--base-url http://localhost:PORT` (after `--` when using npm), or set `BOUNDARY_BASE_URL`.

> The runner, smoke tests and e2e tests **reset the local database** (reseed). Any edits you made in the UI are wiped, and existing sessions are invalidated, so you will need to log in again.

---

## Running in Docker

The app also ships as a container image (`Dockerfile`), so the same production build runs locally, in CI, or anywhere else:

```bash
docker compose --profile app up -d --build --wait   # Postgres + the app (production build) on :3000
npm run db:seed                                     # from the host, against localhost:5440
npm run test:authz                                  # the runner works against the container unchanged
```

- **Two-service compose, `db` stays the default.** The `app` service sits behind a compose profile, so plain `docker compose up -d --wait` (`npm run db:up`) still starts only Postgres for local `npm run dev`. The app's host port is `BOUNDARY_APP_PORT` (default 3000).
- **Multi-stage image.** `deps` runs `npm ci --ignore-scripts` from the lockfile; `build` runs `next build` with `output: "standalone"` (switched on by `BOUNDARY_STANDALONE=1` only inside the image, so local `next start` and CI are unchanged); `runtime` is `node:24-bookworm-slim` with just the traced server bundle, static assets and the migration script. Debian slim, not Alpine, because `@node-rs/argon2` ships prebuilt glibc binaries.
- **Non-root, read-only app files.** The process runs as the image's `node` user; the application files are root-owned, and only `.next/cache` is writable.
- **Migrations run on start** (`node scripts/migrate.ts && exec node server.js`). `exec` makes the Node server the process that receives `SIGTERM` from `docker stop`, so the graceful shutdown below actually runs. `init: true` adds a minimal init for signal forwarding and zombie reaping.
- **Seeding stays on the host.** `scripts/seed.ts` wipes the database and refuses any `DATABASE_URL` that isn't localhost. Inside the compose network the host is `db`, and loosening that guard to make the container self-seeding isn't worth it.
- **Health.** The image has a `HEALTHCHECK` on `/api/health` (DB reachable), and `--wait` blocks until it passes.
- **Production semantics.** `NODE_ENV=production`, so the unsafe demo toggle can't be enabled in the container and session cookies are `Secure` (browsers accept those on `http://localhost`).

---

## Architecture

```
Browser ──► Next.js App Router (one process)
             ├─ Server components (pages)      ─┐
             │    read via the service layer     │  both call the same
             ├─ Route handlers  /api/**          │  service functions
             │    every mutation goes here      ─┘
             │
             ├─ src/lib/api.ts        authed() wrapper: session → CSRF → handler
             ├─ src/lib/auth/*        sessions, CSRF, login, throttling, argon2id
             ├─ src/lib/services/*    documents / projects / users: SQL + authz
             ├─ src/lib/permissions.ts  the permission matrix as pure functions
             └─ src/lib/db.ts         pg Pool, parameterized queries only
                         │
                         ▼
                   PostgreSQL (raw SQL, no ORM)
```

- **One enforcement path.** Pages and the API call the same service functions in `src/lib/services/`. UI mutations are `fetch` calls to the same `/api/**` handlers the test runner exercises, so UI and API cannot drift.
- **No ORM.** All SQL is handwritten and parameterized, so every tenant filter is visible in code review. That's the main reason for the choice: the security logic should be auditable line by line.
- **Identity per request.** `authed()` in `src/lib/api.ts` resolves the session cookie to `{ userId, companyId, role }` with a fresh DB read on **every** request (`resolveSession` in `src/lib/auth/session.ts`). Handlers never read company, owner or role from the request.
- **Two layers of authorization:**
  1. *Tenancy* is enforced in SQL. Every read and write on projects/documents/users includes `company_id = $tenant`. Document writes also check the parent project's `company_id` (`EXISTS (SELECT 1 FROM projects p WHERE p.id = d.project_id AND p.company_id = $2)`).
  2. *Role/ownership* within the tenant is decided by `src/lib/permissions.ts`.

  A bug in layer 2 can at worst leak within one company, never across companies.
- **Paginated lists.** `GET /api/projects/:id/documents` and `GET /api/admin/users` take `?limit=` (1-100, default 25) and `?cursor=`, validated by a strict zod schema (`src/lib/pagination.ts`; unknown params or a malformed cursor are 400), and return `{ items, nextCursor }`. The tenant filter and the `LIMIT` are in the same SQL statement, so rows are scoped to the caller's company *before* a page is cut, never filtered in memory afterwards. See [Performance notes](#performance-notes) for why it's keyset rather than offset.
- **Connection pool and shutdown.** `src/lib/db.ts` creates one `pg` Pool per process with explicit limits (10 connections, 30 s idle timeout, 5 s connect timeout so a dead DB fails requests instead of hanging them, 10 s `statement_timeout`) and an `error` listener, without which an idle client dropped by a DB restart would crash the process. `src/instrumentation.ts` ends the pool on `SIGTERM`/`SIGINT`. Next's own handler drains in-flight HTTP requests in parallel; the trade-off is documented in that file.

### Data model (`db/migrations/001_init.sql`)

`companies`, `users(company_id, email, password_hash, role, is_active)`, `sessions(user_id, token_hash, csrf_hash, expires_at)`, `projects(company_id, name)`, `documents(project_id, company_id, owner_user_id, title, body)`, `login_attempts`.

Deliberate defense-in-depth choices:

- **`company_id` is stored redundantly on child rows** (projects, documents). Every query filters on tenant directly instead of through join chains, which keeps the filter obvious and hard to forget.
- **Composite foreign keys** `documents(project_id, company_id) → projects(id, company_id)` and `documents(owner_user_id, company_id) → users(id, company_id)`. The database itself refuses a document whose project or owner belongs to a different company, even if application code had a bug.
- **Sessions hold no authorization data.** Only `user_id`, a SHA-256 hash of the token, a hash of the CSRF token, and an expiry. Role and active status are always read from `users`.

---

## Performance notes

Nothing here has been load-tested (see limitations). The point is that every hot query has an index shaped to it, and that can be checked with `EXPLAIN`, not taken on faith.

### Indexes (`db/migrations/002_indexes.sql`)

Each index matches a specific `WHERE` / `ORDER BY` in `src/lib/services/*` or `src/lib/auth/*`:

| Index | Serves | Why this shape |
|-------|--------|----------------|
| `documents (company_id, project_id, created_at, id)` | Document list: `WHERE project_id = $1 AND company_id = $2 AND (created_at, id) > (...) ORDER BY created_at, id LIMIT n` | Equality columns first, then the sort key: Postgres reads exactly one page off the index with no sort step (verified: `Index Only Scan ... Index Cond: company_id = ... AND project_id = ... AND ROW(created_at, id) > ROW(...)`). The leading pair also serves the per-project `document_count` subquery and the composite FK to `projects` that `ON DELETE CASCADE` walks. Replaces 001's `(company_id, project_id)`. |
| `documents (owner_user_id, company_id)` | The composite FK `(owner_user_id, company_id) → users` | Postgres indexes the *referenced* side of a FK automatically, never the *referencing* side. Without it, any delete or key update on `users` (including a company-level cascade) scans every document. The app doesn't delete users today, so this is cheap insurance. |
| `users (company_id, created_at, id)` | Admin user list, keyset-paginated | Same pattern as documents. Replaces `(company_id)`. |
| `projects (company_id, name)` | Dashboard: `WHERE company_id = $1 ORDER BY name` | Returns projects already sorted. Replaces `(company_id)`. |
| `sessions (expires_at)` | `DELETE FROM sessions WHERE expires_at <= now()` (`npm run db:cleanup`) | Range scan of only the expired rows instead of a full scan of all sessions. |

Already in place from `001_init.sql` and deliberately not duplicated: `users (lower(email))` UNIQUE (login is `WHERE lower(email) = lower($1)`, so the index must be on the expression, not the bare column), `sessions (token_hash)` UNIQUE (every authenticated request), `sessions (user_id)` (deleting a deactivated user's sessions). Separate single-column indexes on `documents(company_id)` or `documents(project_id)` would be redundant: the composite index answers both as long as `company_id` is in the filter, and every document query has it.

The migration uses plain `CREATE INDEX` because `scripts/migrate.ts` runs each file in a transaction and `CREATE INDEX CONCURRENTLY` can't run inside one. Plain `CREATE INDEX` blocks writes to the table while it builds; on a large live table you'd run `CONCURRENTLY` outside a transaction instead.

### Keyset pagination, not OFFSET

Pages are ordered by `(created_at, id)` and the cursor is the last row's `(created_at, id)`, base64url-encoded. The next page is `WHERE ... AND (created_at, id) > ($ts, $id)`.

- **Flat cost per page.** `OFFSET 10000` still reads and throws away 10,000 rows; a seek reads one page from the index wherever it is.
- **Stable under writes.** A row inserted or deleted between requests doesn't shift later pages, so paging never shows duplicates or skips rows.
- **`id` breaks ties.** Seed rows are inserted in one transaction and share a `created_at`; without the tie-breaker their order, and so the page boundaries, would be undefined.
- **Microsecond-exact cursor.** The timestamp in the cursor comes from Postgres (`to_char(... 'US')`), not a JS `Date`. A `Date` keeps milliseconds only, and a rounded cursor would skip or repeat rows that differ below a millisecond.
- **Cursors carry no authority.** A cursor is only a position. Tenant scoping always comes from the session in SQL, so a cursor copied from another company's listing can't select that company's rows.
- **Trade-off:** forward-only "Next page" links and no total count. For a document list that's the right call; a UI that needs "jump to page 7" would use OFFSET with a capped page number.

### Expired sessions

Expired sessions were never a security issue (`resolveSession` checks `expires_at > now()`), but the rows were never deleted either. `scripts/cleanup-sessions.ts` (`npm run db:cleanup`) deletes expired sessions and stale `login_attempts` rows. It is a script to run periodically (cron, a scheduled CI job, a Kubernetes CronJob), **not** a background worker in the app: that keeps the server stateless and the cleanup independently schedulable. The trade-off is that if nobody schedules it, dead rows accumulate. That costs disk, not correctness. A lazy delete on login would have needed no scheduler, but it only ever cleans up after users who come back.

---

## Permission matrix

Within the user's **own company only**. Nobody can act across companies, regardless of role.

| Action                                          | Member              | Admin |
|-------------------------------------------------|---------------------|-------|
| Read projects in own company                    | yes                 | yes   |
| Read all documents in own company               | yes                 | yes   |
| Create documents in own company's projects      | yes                 | yes   |
| Edit / delete **own** documents                 | yes                 | yes   |
| Edit / delete **other users'** documents        | **no** (403)        | yes (admin override) |
| Create / rename / delete projects               | **no** (403)        | yes   |
| List users, create demo users                   | **no** (403)        | yes (new users always start as member) |
| Change roles (member <-> admin)                 | **no** (403)        | yes (not their own role) |
| Deactivate / reactivate users                   | **no** (403)        | yes (not themselves) |
| Anything on another company's data              | **no** (404)        | **no** (404) |

Implemented in `src/lib/permissions.ts` (role/ownership) plus the tenant filters in `src/lib/services/*.ts`.

Admins can't demote or deactivate themselves (400). This stops a company from locking itself out of administration by accident.

### Status-code policy

| Situation                                                  | Status |
|------------------------------------------------------------|--------|
| No session, unknown/forged/expired token, deactivated user | 401    |
| Same company, forbidden by role or ownership; bad CSRF     | 403    |
| Resource doesn't exist **or belongs to another company**   | 404    |
| Validation failure, unknown fields in body                 | 400    |
| Wrong Content-Type on a body                               | 415    |
| Login locked out                                           | 429    |

Ordering detail: role-gated endpoints (project and user management) check the role **before** looking up the target. A member gets 403 for any id, whether it exists or not, in any company, so a 403 reveals nothing about other tenants. An admin targeting another company's resource passes the role check and then gets 404 from the tenant-scoped lookup.

Pages follow the same policy: a member opening `/admin` gets an HTTP 403 page (`forbidden()` with Next's `authInterrupts`), and a foreign project or document page is a 404.

---

## Security controls

| # | Requirement | Where |
|---|-------------|-------|
| 1 | Identity from the session cookie, re-read from DB on every request; never trust client tenant/role | `src/lib/auth/session.ts` `resolveSession`, `src/lib/api.ts` `authed` |
| 2 | Parameterized SQL only; `company_id = $tenant` on every project/document read **and** write, including the parent-project check on document writes | `src/lib/services/*.ts` |
| 3 | Mass-assignment protection: strict zod schemas whitelist fields. `company_id`, `owner_user_id`, `role` have no schema and are set server-side only | `src/lib/validation.ts` |
| 4 | 401 / 403 / 404 / 400 policy | `src/lib/errors.ts`, services |
| 5 | Deactivation and role changes are immediate (no role or active flag in the session) | `resolveSession`; `setUserActive` also deletes the user's sessions |
| 6 | CSRF: double-submit token bound to the session | `src/lib/auth/csrf.ts` |
| 7 | Login throttling | `src/lib/auth/throttle.ts` |
| 8 | Logging redacts passwords, tokens, cookies, document bodies | `src/lib/redact.ts`, `src/lib/log.ts` |
| 9 | zod validation on every mutation | `src/lib/validation.ts` + `parseJson` in `src/lib/api.ts` |

### Sessions

- Token: `crypto.randomBytes(32).toString('hex')`, opaque. The DB stores only `sha256(token)` and an expiry (8 hours). A database leak does not yield usable cookies.
- Cookie `boundary_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `NODE_ENV=production` (override with `COOKIE_SECURE=0|1`).
- Logout deletes the session row. Deactivation deletes all of that user's session rows.
- **Deactivation is enforced twice, on purpose:** (a) `resolveSession` rejects `is_active = false` on every request, and (b) sessions are deleted so reactivating a user does not bring old, possibly stolen, tokens back to life. Runner case 5.7 tests (a) alone by flipping `is_active` directly in the DB without touching sessions.

### Passwords

argon2id via `@node-rs/argon2`, using the library defaults (m=19 MiB, t=2, p=1), which match the OWASP Password Storage Cheat Sheet's minimum. I picked it over `bcrypt` because it ships prebuilt N-API binaries (no `node-gyp` toolchain on Windows or CI), it's the current OWASP first choice, and it has no 72-byte input truncation. Unknown-email logins still run a dummy verification so response time doesn't reveal whether an account exists. Every login failure returns the same generic 401.

### CSRF (why, when SameSite=Lax already exists)

At login the server sets a second, **readable** cookie `boundary_csrf` with a random token, and stores `sha256(token)` on the session row. Browser code (`src/lib/client/api.ts`) echoes it in an `x-csrf-token` header on every mutation. The server requires header == cookie, **and** `sha256(header)` == the session's `csrf_hash`, compared in constant time. A cross-site page can make the browser *send* cookies but can't *read* them, so it can't forge the header. Mutating requests with an `Origin` header that doesn't match `Host` are also rejected, and bodies must be `application/json`, which can't be sent cross-origin without a CORS preflight.

SameSite=Lax alone isn't treated as sufficient because:
- it does nothing against *same-site* attackers (a compromised or user-content app on a sibling subdomain counts as "same site");
- binding the token to the session also defeats cookie-tossing from such a subdomain;
- browser behaviour has varied historically (e.g. Lax-by-default grace periods, older or embedded browsers);
- it's cheap, explicit, and testable (runner cases 8.3 and 8.4).

Login itself is not CSRF-token protected (there's no session yet). It is protected by the Origin check and the JSON content type. Login CSRF is listed under limitations.

### Login throttling

A DB table `login_attempts` keyed by `lower(email) | client-ip`. Five failures within 15 minutes lock that key for 5 minutes (429, password not checked). It is **not** production-grade:
- the client IP only comes from `X-Forwarded-For` when `TRUST_PROXY_HEADERS=1` (the header is spoofable otherwise). Without it, all clients share one bucket, so the lock is effectively per email, which means an attacker can lock a victim out for 5 minutes;
- there's no global or per-IP rate limit across many emails (credential stuffing), and no distributed counter.

### Logging

`src/lib/log.ts` writes one JSON line per event, and every field passes through `redact()`. Keys matching `password|token|secret|cookie|authorization|csrf|session|body|hash` become `[REDACTED]`, and any 64-hex-char token inside a string is masked. Callers log ids and outcomes, never payloads. Login events do include the email address (useful for spotting abuse). Remove it if you treat emails as sensitive.

### Content-Security-Policy

Pages get a **nonce-based CSP** generated per request in `src/proxy.ts` (Next 16's renamed middleware):

```
default-src 'self'; script-src 'self' 'nonce-<random>' 'strict-dynamic'; style-src 'self' 'nonce-<random>';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

- **No `'unsafe-inline'` for scripts.** Next.js bootstraps with inline `<script>` tags. Instead of allowing all inline script, the proxy puts a fresh 128-bit nonce in the CSP *request* header; Next reads it while rendering and stamps it on its own scripts. `'strict-dynamic'` lets those trusted scripts load further chunks. An injected `<script>` or `onerror=` handler has no nonce and is blocked, so CSP is a second layer behind React's escaping.
- **Nonces need per-request rendering.** Every page here is already dynamic (the root layout reads the session cookie), so this costs nothing extra.
- **Dev-only relaxations:** `'unsafe-eval'` (React's dev tooling) and `'unsafe-inline'` styles (the dev server injects `<style>` tags). Neither is present under `next build && next start`, which is what CI and the Docker image run.
- **`frame-ancestors 'none'`** is the modern equivalent of `X-Frame-Options: DENY`; both are sent for older browsers.
- **API responses** carry a static `default-src 'none'; frame-ancestors 'none'`. They're JSON, but if one is ever opened as a document, nothing in it can load or run.
- **No `upgrade-insecure-requests` or HSTS.** The app is served over plain http locally and in CI. Both belong at the TLS terminator in a real deployment.
- **Verified in a browser.** The Playwright suite asserts the header shape and that logging in, navigating and opening the document editor produce zero CSP violations in the console.

### Other hardening

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `X-Powered-By` removed (`next.config.ts`). `same-origin` is kept over the more common `strict-origin-when-cross-origin` because it is stricter (no `Referer` leaves the site at all) and every link in this app is same-origin. React escapes rendered output by default. Document bodies are shown as text, never as HTML.

---

## Threat model

**In scope:**
- **Tenant isolation (horizontal escalation / IDOR):** a user of company B reading, listing, modifying, deleting or planting data in company A by id.
- **Privilege escalation within a tenant (vertical escalation):** a member performing admin actions; a member modifying documents they don't own; mass-assignment of `company_id` / `owner_user_id` / `role`.
- **Stale authorization / session revocation:** a deactivated user, or a demoted admin, continuing with an existing, unexpired session.
- **CSRF** against cookie-authenticated mutations.
- **Online password guessing** (basic throttling only).
- **Secrets in logs** (redaction).

**Explicitly out of scope:**
- XSS hardening beyond React's default escaping and the nonce-based CSP above (no Trusted Types, no CSP violation reporting endpoint).
- Rate limiting beyond the basic login lockout. No DoS protection.
- Infrastructure security: TLS termination, secret management, network policy, DB hardening, backups. Docker credentials are throwaway local values.
- Account lifecycle: password reset, MFA, email verification, session listing and remote logout UI.
- Audit logging beyond simple structured log lines.
- Supply-chain security of dependencies.

This is not production-hardened. "All tests pass" means the specific behaviours below are verified, nothing more.

---

## Test runner

`test-runner/` is a standalone TypeScript CLI, run by Node directly.

| File | Purpose |
|------|---------|
| `run.ts` | CLI: target checks, health check, mode detection, runs groups, prints and writes `test-results.json` |
| `cases.ts` | The 57 cases in 8 groups (below) |
| `adapter.ts` | **Endpoint adapter**: the typed interface plus `BoundaryHttpAdapter`, written for this app's HTTP API |
| `fixtures.ts` | Hardcoded identities and IDs (imported from `scripts/seed-data.ts`), DB reset, direct-DB fixture helper |
| `safe-http.ts` | `fetch` with `redirect: 'manual'`; follows same-origin redirects itself and refuses any cross-origin hop |
| `config.ts` | Default target, loopback hosts, the (empty) remote allowlist |
| `smoke.ts` | UI smoke tests |
| `assert-unsafe-results.ts` | CI check on the unsafe-mode results file |

**Fixtures are explicit.** Emails, the demo password, project ids and document ids are hardcoded in `scripts/seed-data.ts` and imported by the runner. Nothing is discovered at runtime.

**Isolation.** Before each of the 8 groups the runner reseeds the local database (`scripts/seed.ts`: truncate and insert), so groups don't depend on each other and runs are repeatable. Users created during a case (second member, second admin) disappear at the next reset. Reset refuses to run unless `DATABASE_URL` points at `localhost`/`127.0.0.1`/`::1`.

**Target safety.** Loopback is the default and the only thing allowed out of the box. Any other host must be added to `AUTHORIZED_REMOTE_HOSTS` in `test-runner/config.ts` (a reviewable code change) **and** the run needs `--i-am-authorized`. Non-local runs also need `--no-reset` (the runner can't reset a remote DB, so DB-level cases are skipped). Redirects are never auto-followed. A redirect to a different origin aborts the request.

**Output.** Each case prints expected status, actual status, PASS/FAIL and a one-line explanation. No tokens, cookies, passwords or document bodies appear in console output or in `test-results.json`.

**Exit codes:** `0` all cases passed · `1` at least one case failed · `2` configuration or startup error (server unreachable, unhealthy, mode mismatch, refused target).

### Cases

| Group | What it proves |
|-------|----------------|
| 1. Cross-tenant reads | Globex member: GET an Acme doc by id → 404 (**case 1.1**, the unsafe-demo target); listing own project contains zero foreign docs; listing an Acme project → 404; GET an Acme project → 404 |
| 2. Cross-tenant writes | Globex **admin**: rename/delete Acme project, edit/delete Acme doc, create doc in Acme project, change role / deactivate Acme user → all 404; then Acme admin confirms nothing changed (200) |
| 3. Member limits | Acme member: create user, promote self, demote admin, deactivate admin, delete project, create project, list users → all 403; then confirm role and project unchanged |
| 4. Ownership | Admin creates a second member who writes a doc; first member edits/deletes it → 403; edits admin's doc → 403; can still read it, unchanged (200) |
| 5. Deactivation | Member's session works (200) → admin deactivates → **same cookie** gets 401 on `/api/me` and on a document read; re-login → 401. Then 5.7: deactivate directly in the DB with session rows left intact → 401 |
| 6. Demotion | Second admin lists users (200) → demoted → **same session** gets 403 on admin actions, but `/api/me` is still 200 with role `member` |
| 7. Positive controls | Same-company read 200, list 200, owner edit 200, member create 201 (owner and company derived from session), admin create user 201, admin override edit 200, admin create/delete project, owner delete 200, Globex reads its own doc 200 |
| 8. Defense extras | `company_id` / `owner_user_id` in body → 400; missing/wrong CSRF → 403; no/forged session → 401; empty title → 400; 6th failed login → 429 |

**Why positive controls matter.** Expected statuses are exact. A server that answers 403/404 to everything would pass groups 1-3 but fail group 7 and every precondition check (2.8, 2.9, 3.8, 3.9, 4.4, 5.1, 6.1, ...). Deny-all shows up as a failing run, not as a way to fake a pass.

### The results page

`/results` server-renders the **latest** `test-results.json` from the repo root on every request (schema-validated with zod). It's not hardcoded, and it can't run anything. There is deliberately **no "re-run" button**: the runner wipes the database and every session, so letting a web request trigger it would be a self-inflicted denial of service, and any endpoint that spawns processes is attack surface this demo doesn't need. Re-run from a terminal and reload. The page needs no login because the file contains only case names, statuses and explanations.

---

## Vulnerability demo: break, detect, fix, pass

The demo mode removes the tenant filter from **exactly one query**: the single-document GET by id.

**Where:** `src/lib/services/documents.ts`, function `getDocumentById`, lines 74-82 (the block marked `UNSAFE DEMO TOGGLE`). The vulnerable query is on **line 80**:

```ts
const result = opts.unsafeDemo
  ? await query<DocumentRow>(`${DOC_SELECT} WHERE d.id = $1`, [id]) // UNSAFE: no company_id filter
  : await query<DocumentRow>(`${DOC_SELECT} WHERE d.id = $1 AND d.company_id = $2`, [id, auth.companyId]);
```

The flag is computed in `src/app/api/documents/[id]/route.ts` (line 10) and `src/app/documents/[id]/page.tsx` (line 12) by `isUnsafeDemoEnabled()` in `src/lib/unsafe-demo.ts`. It's **off by default** and only turns on when **all** of these hold:

1. `BOUNDARY_UNSAFE_DEMO_MODE=1`
2. `BOUNDARY_ALLOW_UNSAFE=local-demo-only`
3. `NODE_ENV !== 'production'`, so `next build && next start` can never enable it (CI checks this)
4. the request's `Host` is `localhost`, `127.0.0.1` or `[::1]`

It's environment-only: no UI, no API, nothing in `.env.example`. `npm run dev:unsafe` (`scripts/dev-unsafe.ts`) sets the two variables for that one process only. Check 4 guards against accidental enablement on a shared machine. It is not a security boundary, since `Host` is client-supplied; checks 1-3 are the real gate. Write paths (`requireDocumentForWrite`, update, delete) never consult the toggle, so the demo exposes reads only.

### Live walkthrough (about 3 minutes)

```bash
# 0. Baseline: safe server, everything passes
npm run dev                       # terminal 1
npm run test:authz                # terminal 2 → "57/57 passed", exit 0

# 1. BREAK: restart the server in unsafe demo mode
#    (Ctrl+C in terminal 1)
npm run dev:unsafe                # big warning banner in the server log

#    Show it by hand: log in at http://localhost:3000 as member@globex.example,
#    then open http://localhost:3000/documents/a0000000-0000-4000-8000-000000000201
#    → Acme's "Skates spec v2" is displayed, with a red UNSAFE DEMO banner.

# 2. DETECT: the runner catches it
npm run test:authz:unsafe         # → banner: "vulnerability DETECTED as designed"
                                  #   exactly 1 failure (1.1), 56 passes, exit 1
#    Open http://localhost:3000/results → case 1.1 highlighted as intentional failure.
#    (Running plain `npm run test:authz` against this server refuses with exit 2:
#     the runner will not silently test an unsafe server as if it were safe.)

# 3. FIX: restart normally (no env vars)
#    (Ctrl+C in terminal 1)
npm run dev

# 4. PASS
npm run test:authz                # → 57/57 passed, exit 0
```

Talking points: the bug is a single missing `AND company_id = $2`, which is the most common real-world multi-tenant bug (broken object-level authorization). Random UUIDs wouldn't have saved it (an id can leak through a URL, a log or a shared link). The positive controls prove the fix isn't "deny everything". Every other control (writes, role checks, listings) kept working because each query enforces tenancy on its own.

---

## CI

`.github/workflows/ci.yml`. The main `authz` job on `ubuntu-latest`:

1. Postgres 16 service container (port 5440); `npm ci`.
2. Lint, typecheck (app plus CLI code), unit tests.
3. Migrate, seed, `next build`.
4. **Safe mode against the production build:** `next start` is launched *with both unsafe env vars set*. `scripts/wait-for-health.ts` polls `/api/health` and asserts the server is up **and** reports `unsafeDemoMode=false`, which proves production refuses the toggle. Then the authorization runner (must exit 0) and the UI smoke tests.
5. **Unsafe mode against `next dev`** on another port (dev mode is required because the toggle refuses `NODE_ENV=production`, by design). The health check must report `unsafeDemoMode=true` first, so a startup crash fails here and can't masquerade as "the vulnerability test failed as expected". The runner must exit exactly `1` (exit 0 would mean the vulnerability went unnoticed, 2 a config error). Then `test-runner/assert-unsafe-results.ts` checks `test-results.json`: mode is `unsafe-demo`, the file is fresh, **only** case 1.1 failed and is marked intentional, all other cases passed, no group setup failed.
6. Results and server logs are uploaded as an artifact.

A second job, **`e2e`**, runs in parallel with its own Postgres service: it installs Chromium only (`npx playwright install --with-deps chromium`), builds, starts `next start`, and runs the Playwright suite against the production build. Its HTML report, traces of failed tests and the server log are uploaded as an artifact. Tests run serially with no retries: a flaky authorization test is a bug, not noise.

Why `next start` for the safe run: it tests what you'd actually deploy (production build, `NODE_ENV=production`, Secure cookies) and doubles as proof that the unsafe toggle is inert there.

---

## Adapting the runner to another API

The runner **does not** understand arbitrary APIs and doesn't try to discover endpoints. The test logic in `cases.ts` talks only to the `AuthzTargetAdapter` interface in `test-runner/adapter.ts`:

```ts
login(label, email, password) · me(s) · getDocument(s, id) · listDocuments(s, projectId)
createDocument(s, projectId, input) · updateDocument(s, id, input) · deleteDocument(s, id)
getProject(s, id) · createProject(s, name) · updateProject(s, id, name) · deleteProject(s, id)
listUsers(s) · createUser(s, email, pw) · changeRole(s, userId, role) · deactivateUser(s, userId)
```

`listDocuments` and `listUsers` return plain arrays. `BoundaryHttpAdapter` unwraps this app's `{ items, nextCursor }` page envelope (first page only; the fixtures fit in one), so the cases don't depend on how the target paginates.

To point it at another application **you own or are explicitly authorized to test**:

1. Write a new class implementing `AuthzTargetAdapter` against that app's real endpoints: its URL shapes, auth mechanism (cookies, bearer tokens), and CSRF scheme. `BoundaryHttpAdapter` is the reference. Group 8 uses BOUNDARY-specific raw requests (CSRF header, body field names) and will need rewriting or dropping.
2. Replace `fixtures.ts`: that system's test identities, tenant/resource ids, and a reset strategy that works for its data (or run with `--no-reset` and accept non-independent groups).
3. Map statuses. If the other API answers cross-tenant access with 403 instead of 404, decide whether that's acceptable for your policy and change the expectations deliberately.
4. Add the host to `AUTHORIZED_REMOTE_HOSTS` in `config.ts` and pass `--i-am-authorized`.

---

## Dependencies

Kept minimal on purpose.

| Package | Why |
|---------|-----|
| `next`, `react`, `react-dom` | App framework (App Router). |
| `pg` | PostgreSQL driver. Raw parameterized SQL, no ORM. |
| `@node-rs/argon2` | argon2id password hashing (reasons above). |
| `zod` | Request-body validation with strict schemas. |
| `server-only` | Build-time guard so DB and auth modules can't be imported into client bundles. |
| dev: `typescript`, `eslint`, `eslint-config-next`, `@types/*` | Tooling from `create-next-app`. |
| dev: `@playwright/test` | Browser e2e tests (`e2e/`). Chromium only. |

Not used: Tailwind or any CSS framework (plain CSS in `src/app/globals.css`, mobile-first with grid/flex breakpoints); `dotenv` (Next loads `.env`; CLI scripts use Node's `--env-file-if-exists`); `tsx` (Node runs the TypeScript CLI directly); a unit test framework (unit tests use the built-in `node:test`); a migration library (`scripts/migrate.ts` is 50 lines and does what's needed).

---

## What is covered by tests, honestly

- **Authorization runner (57 cases)**: black-box integration tests over HTTP against a real server and a real Postgres. This is the main evidence.
- **UI smoke tests (14 checks)**: fetch server-rendered HTML and string-match: login form renders, anonymous `/dashboard` redirects to `/login`, each of the 4 users sees only their own company and role, member `/admin` is HTTP 403, foreign project/document pages are 404 with no leaked content, the owner sees the editor and a non-owner doesn't, `/results` renders. They don't run JavaScript or click anything.
- **Unit tests (16, `node:test`)**: the permission functions, the unsafe-mode guard (every combination that must stay off), log redaction, and the runner's target allowlist.
- **Browser e2e tests (7, Playwright, Chromium, `e2e/`)**: login through the real form (success, and wrong password showing the generic error with no session created), the dashboard showing the right company and role, no admin entry point for a member, a member opening `/admin` directly getting a real HTTP 403 page with no user list behind it, another company's document and project URLs returning 404 with no leaked content, a project page listing only own-company documents, and the CSP: correct header shape plus zero CSP violations while logging in, navigating client-side and opening the document editor. `globalSetup` reseeds the database and refuses non-local targets.

Not covered: admin mutations clicked through the UI (role change, deactivate, create/delete project buttons; those are covered at the HTTP level by the runner), pagination clicked through the UI (seed data fits in one page; the API paging was checked by hand, not by an automated test), responsive layout at phone widths, browsers other than Chromium, concurrency and race conditions, session expiry by time.

### Expanding the UI tests

Partially done: `e2e/` covers the read-side flows above. Next steps would be specs that click the admin buttons and assert both the DOM and the follow-up API state, a `page.setViewportSize({ width: 375, height: 800 })` pass for mobile layout, and a pagination spec that creates more than one page of documents. `test-runner/smoke.ts` stays: it's fast, needs no browser, and runs in the main CI job.

---

## Known limitations

- Login CSRF isn't covered by a token (mitigated by the Origin check and JSON-only bodies).
- Emails are globally unique, so "Email already in use" (409) on user creation reveals that an email exists somewhere in the system.
- Throttling has the limitations listed above (shared bucket without a trusted proxy, victim lockout possible, no global rate limit).
- No session idle-timeout separate from the 8-hour absolute expiry. Expired sessions are only purged when `npm run db:cleanup` is run; nothing schedules it.
- The CSP allows `'unsafe-eval'` and inline styles under `next dev` only; there's no violation reporting endpoint.
- Pagination is forward-only with no total count (see [Performance notes](#performance-notes)).
- On shutdown the pool is closed alongside Next's request drain, not strictly after it (trade-off explained in `src/instrumentation.ts`).
- The unsafe-mode Host check trusts the `Host` header (it's an accident guard, not a security control).
- Single process, single database; nothing here was load-tested.

Again: this is a teaching and interview project. It demonstrates specific controls and proves them with tests. It makes no claim of being secure in general.

---

## Development

- **Before pushing:** `npm run lint && npm run typecheck && npm run test:unit`, then with a server running, `npm run test:authz` and `npm run test:e2e`. CI runs all of these plus the unsafe-mode check.
- **Schema changes:** add a new numbered file in `db/migrations/`; never edit an applied one. `scripts/migrate.ts` applies each file once, in a transaction, and records it in `schema_migrations`.
- **Style:** explicit parameterized SQL in small service modules, every tenant-owned query filtered on `company_id` from the session, zod `.strict()` schemas for every input. `.editorconfig` covers whitespace; ESLint is the `create-next-app` config.
- **New endpoint checklist:** wrap it in `authed()`, take identity only from `auth`, put the tenant filter in the SQL, and add runner cases for both the denial and the positive control.

---

## License

MIT. See [LICENSE](LICENSE).
