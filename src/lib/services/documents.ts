import 'server-only';
import type { AuthContext } from '../auth/session';
import { query } from '../db';
import { forbidden, isUuid, notFound } from '../errors';
import { cursorTsSql, toPage, type Page, type PageRequest } from '../pagination';
import { canCreateDocument, canModifyDocument } from '../permissions';
import { requireProject } from './projects';

// Tenant rule for this file: EVERY query filters on `company_id = <auth.companyId>`.
// The one deliberate exception is the UNSAFE DEMO branch in getDocumentById,
// which only runs when isUnsafeDemoEnabled() is true (see src/lib/unsafe-demo.ts).

export interface DocumentDto {
  id: string;
  projectId: string;
  companyId: string;
  ownerUserId: string;
  ownerEmail: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type DocumentWithPermissions = DocumentDto & { canEdit: boolean };

interface DocumentRow {
  id: string;
  project_id: string;
  company_id: string;
  owner_user_id: string;
  owner_email: string;
  title: string;
  body: string;
  created_at: Date;
  updated_at: Date;
}

const DOC_SELECT = `
  SELECT d.id, d.project_id, d.company_id, d.owner_user_id, u.email AS owner_email,
         d.title, d.body, d.created_at, d.updated_at
    FROM documents d
    JOIN users u ON u.id = d.owner_user_id AND u.company_id = d.company_id`;

function toDto(r: DocumentRow): DocumentDto {
  return {
    id: r.id,
    projectId: r.project_id,
    companyId: r.company_id,
    ownerUserId: r.owner_user_id,
    ownerEmail: r.owner_email,
    title: r.title,
    body: r.body,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function withPermissions(auth: AuthContext, doc: DocumentDto): DocumentWithPermissions {
  return { ...doc, canEdit: canModifyDocument(auth, doc) };
}

/**
 * Single document by id. Used by GET /api/documents/:id and the document page.
 * 404 if it does not exist OR belongs to another company.
 */
export async function getDocumentById(
  auth: AuthContext,
  id: string,
  opts: { unsafeDemo: boolean },
): Promise<DocumentWithPermissions> {
  if (!isUuid(id)) throw notFound();

  // ========================= UNSAFE DEMO TOGGLE =========================
  // When (and only when) unsafe demo mode is enabled, this ONE query drops the
  // tenant filter, so any logged-in user can read any company's document by id
  // (an IDOR / broken object-level authorization bug). This is the vulnerability
  // the test runner is expected to catch. Every other query in the app is unaffected.
  const result = opts.unsafeDemo
    ? await query<DocumentRow>(`${DOC_SELECT} WHERE d.id = $1`, [id]) // UNSAFE: no company_id filter
    : await query<DocumentRow>(`${DOC_SELECT} WHERE d.id = $1 AND d.company_id = $2`, [id, auth.companyId]);
  // ======================================================================

  const row = result.rows[0];
  if (!row) throw notFound();
  return withPermissions(auth, toDto(row));
}

/** Tenant-scoped lookup used before every write. Never affected by the demo toggle. */
async function requireDocumentForWrite(auth: AuthContext, id: string): Promise<DocumentDto> {
  if (!isUuid(id)) throw notFound();
  const { rows } = await query<DocumentRow>(
    `${DOC_SELECT}
      WHERE d.id = $1
        AND d.company_id = $2
        AND EXISTS (SELECT 1 FROM projects p WHERE p.id = d.project_id AND p.company_id = $2)`,
    [id, auth.companyId],
  );
  if (!rows[0]) throw notFound();
  return toDto(rows[0]);
}

/**
 * One page of a project's documents, keyset-paginated on (created_at, id).
 * The tenant filter and the LIMIT are both in SQL, so pagination happens
 * after tenant scoping inside the database, never on an unfiltered set.
 */
export async function listDocumentsInProject(
  auth: AuthContext,
  projectId: string,
  page: PageRequest,
): Promise<Page<DocumentWithPermissions>> {
  await requireProject(auth, projectId); // 404 if not in caller's company
  const params: unknown[] = [projectId, auth.companyId, page.limit + 1];
  let seek = '';
  if (page.after) {
    params.push(page.after.createdAt, page.after.id);
    seek = 'AND (d.created_at, d.id) > ($4::timestamptz, $5::uuid)';
  }
  const { rows } = await query<DocumentRow & { cursor_ts: string }>(
    `SELECT d.id, d.project_id, d.company_id, d.owner_user_id, u.email AS owner_email,
            d.title, d.body, d.created_at, d.updated_at, ${cursorTsSql('d.created_at')} AS cursor_ts
       FROM documents d
       JOIN users u ON u.id = d.owner_user_id AND u.company_id = d.company_id
      WHERE d.project_id = $1 AND d.company_id = $2 ${seek}
      ORDER BY d.created_at, d.id
      LIMIT $3`,
    params,
  );
  return toPage(rows, page.limit, (r) => withPermissions(auth, toDto(r)));
}

export async function createDocument(
  auth: AuthContext,
  projectId: string,
  input: { title: string; body: string },
): Promise<DocumentWithPermissions> {
  await requireProject(auth, projectId); // 404 if not in caller's company
  if (!canCreateDocument(auth)) throw forbidden();
  // company_id and owner_user_id come from the session, never from the request.
  const { rows } = await query<{ id: string }>(
    `INSERT INTO documents (project_id, company_id, owner_user_id, title, body)
     SELECT p.id, p.company_id, $3, $4, $5
       FROM projects p
      WHERE p.id = $1 AND p.company_id = $2
     RETURNING id`,
    [projectId, auth.companyId, auth.userId, input.title, input.body],
  );
  if (!rows[0]) throw notFound();
  return getDocumentById(auth, rows[0].id, { unsafeDemo: false });
}

export async function updateDocument(
  auth: AuthContext,
  id: string,
  input: { title?: string; body?: string },
): Promise<DocumentWithPermissions> {
  const existing = await requireDocumentForWrite(auth, id); // 404 across tenants
  if (!canModifyDocument(auth, existing)) throw forbidden('Only the owner or an admin can edit this document');
  const { rowCount } = await query(
    `UPDATE documents d
        SET title = COALESCE($3, d.title),
            body = COALESCE($4, d.body),
            updated_at = now()
      WHERE d.id = $1
        AND d.company_id = $2
        AND EXISTS (SELECT 1 FROM projects p WHERE p.id = d.project_id AND p.company_id = $2)`,
    [id, auth.companyId, input.title ?? null, input.body ?? null],
  );
  if (rowCount === 0) throw notFound();
  return getDocumentById(auth, id, { unsafeDemo: false });
}

export async function deleteDocument(auth: AuthContext, id: string): Promise<void> {
  const existing = await requireDocumentForWrite(auth, id);
  if (!canModifyDocument(auth, existing)) throw forbidden('Only the owner or an admin can delete this document');
  const { rowCount } = await query(
    `DELETE FROM documents d
      WHERE d.id = $1
        AND d.company_id = $2
        AND EXISTS (SELECT 1 FROM projects p WHERE p.id = d.project_id AND p.company_id = $2)`,
    [id, auth.companyId],
  );
  if (rowCount === 0) throw notFound();
}
