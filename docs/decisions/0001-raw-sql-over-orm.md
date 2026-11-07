# 1. Raw parameterized SQL instead of an ORM

## Status

Accepted. In place since the first commit; unchanged since.

## Context

Every data-access path in this app -- documents, projects, users, the admin audit log -- carries a tenant boundary (`company_id`) and, within a tenant, a role/ownership check. The project's entire purpose is to make that boundary checkable: a reviewer (or a hiring manager) should be able to open any query that touches tenant data and see the `company_id = $tenant` filter right there, not trust that an ORM or query builder adds it correctly under the hood.

`pg` (node-postgres) is used directly in `src/lib/services/*.ts` and `src/lib/db.ts`, with no ORM or query builder layer in between.

## Decision

Write and review SQL by hand, with parameterized queries (`$1`, `$2`, ...) everywhere, and no ORM.

## Alternatives considered

- **A full ORM (Prisma, TypeORM, Drizzle's relational API, etc.).** Would generate the tenant-scoping `WHERE` clause from a schema/relations definition rather than from code a reviewer reads directly at the call site. The risk isn't that ORMs are insecure -- they parameterize correctly -- it's that the tenant filter would live in a model/relations definition once, applied implicitly everywhere, instead of being visible in every single query. For a project whose entire point is "the tenant filter is auditable," that indirection works against the goal.
- **A query builder (Kysely, Knex) without a full ORM.** A real middle ground: still typed, still visible per-query, less boilerplate than raw `pg`. Not used here mainly because the query surface is small enough (a handful of services, each with a handful of queries) that handwritten SQL costs little and keeps the dependency list minimal. On a larger schema, a query builder would be the more realistic alternative to raw SQL, not a full ORM.

## Trade-offs

- **Cost:** no auto-generated types from the schema (query result shapes are typed by hand at each call site), more boilerplate than an ORM for simple CRUD, and the composite foreign keys (`documents(owner_user_id, company_id) -> users(id, company_id)`, see [ADR 0003](0003-tenant-boundary-enforcement.md)) have to be declared and maintained in migration SQL rather than a schema DSL.
- **Benefit:** every tenant filter is a `grep`-able, line-by-line reviewable `WHERE company_id = $N`. There is no second place (an ORM's query compiler) where that filter could be silently dropped, cached incorrectly, or applied only to some generated queries and not others.
- This trade only makes sense at this project's scale. A larger application with dozens of services and a wide, evolving schema would pay a real maintenance cost for handwritten SQL that a query builder or ORM would absorb; the choice here is specific to a small, security-focused demo where auditability was weighted above developer throughput.
