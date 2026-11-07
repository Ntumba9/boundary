import 'server-only';
import type { AuthContext } from '../auth/session';
import { query } from '../db';
import { forbidden, isUuid, notFound } from '../errors';
import { canManageProjects } from '../permissions';

export interface ProjectDto {
  id: string;
  companyId: string;
  name: string;
  documentCount: number;
  createdAt: string;
}

interface ProjectRow {
  id: string;
  company_id: string;
  name: string;
  document_count: string | number;
  created_at: Date;
}

const PROJECT_SELECT = `
  SELECT p.id, p.company_id, p.name, p.created_at,
         (SELECT count(*) FROM documents d WHERE d.project_id = p.id AND d.company_id = p.company_id) AS document_count
    FROM projects p`;

function toDto(r: ProjectRow): ProjectDto {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    documentCount: Number(r.document_count),
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * Role-gated mutations check the role BEFORE looking the project up. A member
 * therefore gets 403 for any project id, existing or not, in any company, so
 * the 403 reveals nothing about other tenants. An admin targeting another
 * company's project passes the role check and then gets 404 from the scoped lookup.
 */
function requireProjectManager(auth: AuthContext): void {
  if (!canManageProjects(auth)) throw forbidden('Admin role required');
}

export async function listProjects(auth: AuthContext): Promise<ProjectDto[]> {
  const { rows } = await query<ProjectRow>(`${PROJECT_SELECT} WHERE p.company_id = $1 ORDER BY p.name`, [
    auth.companyId,
  ]);
  return rows.map(toDto);
}

/** 404 unless the project exists AND belongs to the caller's company. */
export async function requireProject(auth: AuthContext, id: string): Promise<ProjectDto> {
  if (!isUuid(id)) throw notFound();
  const { rows } = await query<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = $1 AND p.company_id = $2`, [
    id,
    auth.companyId,
  ]);
  if (!rows[0]) throw notFound();
  return toDto(rows[0]);
}

export async function createProject(auth: AuthContext, input: { name: string }): Promise<ProjectDto> {
  requireProjectManager(auth);
  const { rows } = await query<{ id: string }>(
    'INSERT INTO projects (company_id, name) VALUES ($1, $2) RETURNING id',
    [auth.companyId, input.name],
  );
  return requireProject(auth, rows[0].id);
}

export async function renameProject(auth: AuthContext, id: string, input: { name: string }): Promise<ProjectDto> {
  requireProjectManager(auth);
  if (!isUuid(id)) throw notFound();
  const { rowCount } = await query('UPDATE projects SET name = $3 WHERE id = $1 AND company_id = $2', [
    id,
    auth.companyId,
    input.name,
  ]);
  if (rowCount === 0) throw notFound();
  return requireProject(auth, id);
}

/** Deleting a project cascades to its documents (FK ON DELETE CASCADE). */
export async function deleteProject(auth: AuthContext, id: string): Promise<void> {
  requireProjectManager(auth);
  if (!isUuid(id)) throw notFound();
  const { rowCount } = await query('DELETE FROM projects WHERE id = $1 AND company_id = $2', [id, auth.companyId]);
  if (rowCount === 0) throw notFound();
}
