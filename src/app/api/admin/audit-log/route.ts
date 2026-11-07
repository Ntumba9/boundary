import { authed, json } from '@/lib/api';
import { parsePageQuery } from '@/lib/pagination';
import { listAuditLog } from '@/lib/services/auditLog';

// GET ?limit=&cursor=  ->  { items: AuditEntryDto[], nextCursor: string | null }
// Admin-only (403 for members) and scoped to the caller's own company in SQL,
// same as every other list endpoint. No UI page reads this; it exists so the
// audit trail is independently verifiable over the API, which is also how
// the authorization test runner checks it (test-runner/cases.ts, group 9).
export const GET = authed(async ({ req, auth }) => json(await listAuditLog(auth, parsePageQuery(req.nextUrl.searchParams))));
