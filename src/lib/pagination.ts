import { z } from 'zod';
import { badRequest, isUuid } from './errors';

// Keyset ("seek") pagination for tenant-scoped lists.
//
// Lists are ordered by (created_at, id). The cursor is the (created_at, id) of
// the last row on the previous page, and the next page is
//   WHERE <tenant filter> AND (created_at, id) > ($ts, $id) ORDER BY created_at, id LIMIT n
// which the composite indexes in db/migrations/002_indexes.sql answer without
// a sort or a scan of skipped rows. Compared with LIMIT/OFFSET:
//   + cost per page stays flat (OFFSET 10000 still reads and discards 10000 rows)
//   + rows inserted or deleted between requests don't shift pages (no duplicates
//     or gaps while paging)
//   - forward-only "next page" links; no "jump to page 7" and no total count
// `id` is the tie-breaker, so rows sharing a created_at (e.g. seed data inserted
// in one transaction) still have a total order.
//
// The cursor is opaque to clients (base64url JSON) but carries no secret and no
// authority: it is only a position. Tenant scoping is always applied in SQL from
// the session, so a cursor copied from another company's listing can at most
// skip rows of the caller's own list; it can never select foreign rows.

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface Cursor {
  /** created_at as an ISO-8601 UTC string with microsecond precision (Postgres resolution). */
  createdAt: string;
  id: string;
}

export interface PageRequest {
  limit: number;
  after: Cursor | null;
}

export interface Page<T> {
  items: T[];
  /** Pass back as ?cursor= to get the next page; null on the last page. */
  nextCursor: string | null;
}

// Microseconds matter: JS Date only keeps milliseconds, and a cursor rounded to
// milliseconds would skip or repeat rows that differ only below that.
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** SQL expression rendering a timestamptz column in the cursor format above. */
export const cursorTsSql = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.id]), 'utf8').toString('base64url');
}

/** Returns null for anything that isn't a well-formed cursor. */
export function decodeCursor(raw: string): Cursor | null {
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [createdAt, id] = parsed;
  if (typeof createdAt !== 'string' || !TS_RE.test(createdAt)) return null;
  if (typeof id !== 'string' || !isUuid(id)) return null;
  return { createdAt, id };
}

// Query-string schema for list endpoints. .strict() like the body schemas:
// unknown parameters are a 400, not silently ignored.
const pageQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    cursor: z.string().max(200).optional(),
  })
  .strict();

/** For API routes: validate ?limit=&cursor=. Malformed input is a 400. */
export function parsePageQuery(params: URLSearchParams): PageRequest {
  const q = pageQuerySchema.parse(Object.fromEntries(params));
  if (q.cursor === undefined) return { limit: q.limit, after: null };
  const after = decodeCursor(q.cursor);
  if (!after) throw badRequest('Invalid cursor');
  return { limit: q.limit, after };
}

/** For pages: a bad or missing ?cursor= just means "first page". */
export function pageFromSearchParam(cursor: string | string[] | undefined): PageRequest {
  const after = typeof cursor === 'string' ? decodeCursor(cursor) : null;
  return { limit: DEFAULT_PAGE_SIZE, after };
}

/**
 * Build a Page from rows fetched with LIMIT (limit + 1): the extra row only
 * signals that another page exists and is not returned.
 */
export function toPage<R extends { cursor_ts: string; id: string }, T>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
): Page<T> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map(map),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.cursor_ts, id: last.id }) : null,
  };
}
