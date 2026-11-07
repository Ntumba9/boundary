import 'server-only';
import { hashPassword } from '../auth/password';
import type { AuthContext } from '../auth/session';
import { query } from '../db';
import { badRequest, forbidden, HttpError, isUuid, notFound } from '../errors';
import { log } from '../log';
import { cursorTsSql, toPage, type Page, type PageRequest } from '../pagination';
import { canManageUsers, type Role } from '../permissions';

export interface UserDto {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: Date;
}

function toDto(r: UserRow): UserDto {
  return { id: r.id, email: r.email, role: r.role, isActive: r.is_active, createdAt: r.created_at.toISOString() };
}

// Same ordering rule as projects: role check first (403 for members on any id),
// then a company-scoped lookup (404 for ids in another company).
function requireUserManager(auth: AuthContext): void {
  if (!canManageUsers(auth)) throw forbidden('Admin role required');
}

/** Admins may not demote or deactivate themselves (prevents locking a company out of administration). */
function rejectSelfChange(auth: AuthContext, targetId: string, what: string): void {
  if (targetId === auth.userId) throw badRequest(`You cannot change your own ${what}`);
}

/** One page of the caller's company users, keyset-paginated on (created_at, id). Admin only. */
export async function listUsers(auth: AuthContext, page: PageRequest): Promise<Page<UserDto>> {
  requireUserManager(auth);
  const params: unknown[] = [auth.companyId, page.limit + 1];
  let seek = '';
  if (page.after) {
    params.push(page.after.createdAt, page.after.id);
    seek = 'AND (created_at, id) > ($3::timestamptz, $4::uuid)';
  }
  const { rows } = await query<UserRow & { cursor_ts: string }>(
    `SELECT id, email, role, is_active, created_at, ${cursorTsSql('created_at')} AS cursor_ts
       FROM users
      WHERE company_id = $1 ${seek}
      ORDER BY created_at, id
      LIMIT $2`,
    params,
  );
  return toPage(rows, page.limit, toDto);
}

/** New users are always created as 'member' in the admin's own company. */
export async function createUser(auth: AuthContext, input: { email: string; password: string }): Promise<UserDto> {
  requireUserManager(auth);
  const passwordHash = await hashPassword(input.password);
  try {
    const { rows } = await query<UserRow>(
      `INSERT INTO users (company_id, email, password_hash, role, is_active)
       VALUES ($1, lower($2), $3, 'member', true)
       RETURNING id, email, role, is_active, created_at`,
      [auth.companyId, input.email.trim(), passwordHash],
    );
    log.info('user_created', { actor: auth.userId, company: auth.companyId, userId: rows[0].id });
    return toDto(rows[0]);
  } catch (err) {
    // Unique violation on email. Emails are global, so this can reveal that an
    // email exists somewhere; accepted for a demo (documented in README).
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'Email already in use');
    throw err;
  }
}

export async function changeRole(auth: AuthContext, targetId: string, role: Role): Promise<UserDto> {
  requireUserManager(auth);
  if (!isUuid(targetId)) throw notFound();
  rejectSelfChange(auth, targetId, 'role');
  const { rows } = await query<UserRow>(
    `UPDATE users SET role = $3 WHERE id = $1 AND company_id = $2
     RETURNING id, email, role, is_active, created_at`,
    [targetId, auth.companyId, role],
  );
  if (!rows[0]) throw notFound();
  // No session update needed: role is read from `users` on every request.
  log.info('user_role_changed', { actor: auth.userId, company: auth.companyId, userId: targetId, role });
  return toDto(rows[0]);
}

export async function setUserActive(auth: AuthContext, targetId: string, isActive: boolean): Promise<UserDto> {
  requireUserManager(auth);
  if (!isUuid(targetId)) throw notFound();
  rejectSelfChange(auth, targetId, 'active status');
  const { rows } = await query<UserRow>(
    `UPDATE users SET is_active = $3 WHERE id = $1 AND company_id = $2
     RETURNING id, email, role, is_active, created_at`,
    [targetId, auth.companyId, isActive],
  );
  if (!rows[0]) throw notFound();
  if (!isActive) {
    // Two independent layers: (1) resolveSession() rejects inactive users on every
    // request, and (2) we also delete their sessions so reactivation does not
    // revive old (possibly stolen) tokens.
    await query('DELETE FROM sessions WHERE user_id = $1', [targetId]);
  }
  log.info('user_active_changed', { actor: auth.userId, company: auth.companyId, userId: targetId, isActive });
  return toDto(rows[0]);
}
