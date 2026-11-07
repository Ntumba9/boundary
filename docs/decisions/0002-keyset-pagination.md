# 2. Keyset (seek) pagination instead of `OFFSET`

## Status

Accepted. Applies to all three paginated list endpoints: `GET /api/projects/:id/documents`, `GET /api/admin/users`, `GET /api/admin/audit-log`.

## Context

Three endpoints return paginated lists, all tenant-scoped and all ordered by insertion. The pagination choice interacts directly with the tenant boundary: a page is cut from rows that are already filtered to the caller's company in the same SQL statement, so pagination needed a shape where the tenant filter and the "next N rows" logic are the same query, not a filter applied before an `OFFSET` or after an in-memory slice.

## Decision

Use keyset (seek) pagination: rows are ordered by `(created_at, id)`, and the cursor is the last row's `(created_at, id)`, base64url-encoded. The next page is `WHERE ... AND (created_at, id) > ($ts, $id) ORDER BY created_at, id LIMIT n`, validated by a strict zod schema (`src/lib/pagination.ts`) so an unknown query param or a malformed cursor is a 400, not a guess.

## Alternatives considered

- **`OFFSET`/`LIMIT`.** The obvious default, and the only option that supports "jump to page 7" or a total count cheaply. Rejected for the main lists here because `OFFSET n` still reads and discards `n` rows server-side, so cost grows with page depth; and a row inserted or deleted between two requests shifts every later `OFFSET`, which can duplicate or skip rows for a caller paging through results. Neither property matters for a demo seeded with a handful of rows, but both are real failure modes for any list that will actually grow, and the index strategy ([`Performance notes`](../../README.md#performance-notes)) was written assuming seek pagination from the start.
- **Cursor based on `id` alone.** Simpler, but ids here are not time-ordered (`gen_random_uuid()`), so an id-only cursor would not produce an insertion-ordered list -- the UI wants "most recently created first," not "lowest id first."
- **Cursor based on `created_at` alone.** Breaks when two rows share a timestamp, which happens routinely in this project because the seed data inserts many rows in a single transaction and therefore a single `now()`. `id` is the tie-breaker that makes the ordering total, not just mostly-total.

## Trade-offs

- **No total count, no "jump to page N."** Only forward paging via `nextCursor`. Right for a document list; wrong for a UI that genuinely needs page numbers, which would need `OFFSET` with a capped page number instead.
- **Cursor precision matters.** The timestamp encoded in the cursor comes from Postgres's own formatting (`to_char(..., 'US')`, microsecond precision), not from a JavaScript `Date`, which only keeps milliseconds. A millisecond-rounded cursor could skip or repeat rows that differ below a millisecond -- a real bug class this design has to actively avoid, not a theoretical one.
- **A cursor carries no authority of its own.** It is only a position to resume from; the tenant filter is still applied independently in the same query from the session, every time. A cursor copied from one company's listing and replayed against another session cannot be used to read that company's rows -- the `company_id` in the `WHERE` clause comes from the caller's session, never from the cursor.
