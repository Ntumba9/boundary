# 3. Tenant isolation enforced in SQL, not in middleware or at the ORM layer

## Status

Accepted. This is the project's central decision -- the one the authorization test runner and the switchable vulnerability demo both exist to prove.

## Context

Every record in this app belongs to exactly one company (`company_id`). The project's stated purpose is to demonstrate that a user of one company can never read, list, modify, delete, or plant data belonging to another company, by any id they can guess or enumerate (see [Threat model](0004-threat-model-scope.md)). That guarantee has to hold under every entry point: pages, API routes, and any future endpoint added later.

There's more than one layer where "belongs to this tenant" could be enforced: a global middleware/proxy that rewrites or rejects requests, an ORM-level "tenant scope" applied automatically to every query, or the SQL itself. BOUNDARY's `src/proxy.ts` (Next's middleware) only sets the per-request CSP nonce for pages -- it explicitly does not and cannot see `company_id`, because it runs before the session is resolved against the database.

## Decision

Enforce the tenant boundary directly in SQL, in the service layer (`src/lib/services/*.ts`), as a `company_id = $tenant` predicate in every query that touches tenant data -- never in middleware, never via an implicit ORM scope, and never by filtering rows in application code after an unscoped query. The tenant id in that predicate always comes from `resolveSession()` (`src/lib/auth/session.ts`), which re-reads the session from the database on every request; it is never accepted from the request body, query string, or headers (see the `authed()` wrapper in `src/lib/api.ts` and its mass-assignment protection).

This is deliberately layered with role/ownership checks (`src/lib/permissions.ts`), but kept as a *separate, lower* layer: a bug in the role/ownership logic can at worst leak data within one company, never across companies, because the tenant filter runs independently of it, in the same query.

Two things make this enforceable rather than just asserted:

- **Composite foreign keys** -- `documents(project_id, company_id) -> projects(id, company_id)` and `documents(owner_user_id, company_id) -> users(id, company_id)`. The database itself refuses to create a document whose project or owner belongs to a different company, even if a service-layer bug tried to.
- **The test runner's group 1 and 2 cases**, which attempt the boundary from both roles (member and admin) and assert a 404, never a 403 -- a cross-tenant request must look identical to "this resource doesn't exist," so a 403 would itself leak that the resource exists somewhere.

## Alternatives considered

- **Request-level middleware that injects or validates `company_id`.** Rejected because Next's middleware/proxy runs before route handlers and without a database round trip in this app's design; it would either need its own session lookup (duplicating `resolveSession()`) or would have to trust a client-supplied tenant id, which reintroduces exactly the mass-assignment risk the service layer is built to prevent. It also wouldn't cover server components reading data directly via the service layer, only the API routes.
- **An ORM/query-builder "tenant scope" applied globally to a model.** Would centralize the filter in one declaration instead of one line per query -- attractive for consistency, but it moves the actual enforcement into a library's query-compilation step, which is harder to audit at the call site and is part of why an ORM wasn't used at all here (see [ADR 0001](0001-raw-sql-over-orm.md)).
- **Row-Level Security (Postgres `RLS` policies) keyed to a session variable.** A legitimate alternative that would enforce the boundary even against a buggy or compromised application query, closer to defense-in-depth than this app currently has. Not used here because it would require setting a trusted per-connection session variable from the pooled `pg.Pool` on every request (not trivial with connection pooling, where connections are reused across requests/users) and because the project's design goal was that the *application-level* SQL itself is the auditable artifact a reviewer reads -- RLS would move part of the enforcement into policy definitions outside the query a reviewer is looking at. This is a reasonable next layer to add, not a rejected idea; see [Known limitations](../../README.md#known-limitations).

## Trade-offs

- **Discipline over structure.** Nothing *mechanically* stops a new query from omitting `company_id = $tenant` -- there's no framework that would simply refuse to run it. The guarantee is that every such query is short, hand-written, and sits next to its test case, not that it's structurally impossible to get wrong. The test runner's groups 1 and 2, run against every change, are the actual backstop.
- **No defense if the application layer itself is compromised.** Because enforcement lives in the queries the application writes, a request that reaches raw SQL execution with attacker-controlled SQL (which parameterization prevents) or a modified deployed binary would bypass it entirely. RLS (above) is the mitigation for that specific class of risk, and is explicitly out of scope today.
- **This is also why the switchable vulnerability demo targets exactly this layer.** `BOUNDARY_UNSAFE_DEMO_MODE` removes the `company_id` filter from one query (`getDocumentById`) -- the demo is a direct test of this ADR's central claim: when the SQL-level filter is gone, the authorization test runner's group-1 case 1.1 is the thing that catches it, immediately and specifically, rather than some other layer quietly compensating.
