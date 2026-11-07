import 'server-only';
import { adminMutationKey, tryConsumeAdminMutation } from '../auth/adminThrottle';
import { hashPassword } from '../auth/password';
import type { AuthContext } from '../auth/session';
import { query, withTransaction } from '../db';
import { badRequest, forbidden, HttpError, isUuid, notFound, tooManyRequests } from '../errors';
import { log } from '../log';
import { cursorTsSql, toPage, type Page, type PageRequest } from '../pagination';
import { canManageUsers, type Role } from '../permissions';
import { recordAdminAudit } from './auditLog';

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

/**
 * Rate limit for create/role/active mutations, shared across the three and
 * scoped to (company, actor) -- see adminThrottle.ts. Called after the
 * permission check (members never reach this; it is not their budget to
 * spend) and before any write, so a throttled request has no side effects.
 */
async function throttleAdminMutation(auth: AuthContext): Promise<void> {
  const allowed = await tryConsumeAdminMutation(adminMutationKey(auth.companyId, auth.userId));
  if (!allowed) throw tooManyRequests('Too many admin actions. Try again shortly.');
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

/**
 * New users are always created as 'member' in the admin's own company.
 *
 * The insert and its audit entry run in one transaction: a unique-email
 * violation rolls both back (there is nothing to roll back yet on the audit
 * side, but withTransaction's ROLLBACK is what guarantees that if the audit
 * insert itself ever failed, the user row would not be left behind either).
 */
export async function createUser(auth: AuthContext, input: { email: string; password: string }): Promise<UserDto> {
  requireUserManager(auth);
  await throttleAdminMutation(auth);
  const passwordHash = await hashPassword(input.password);
  try {
    return await withTransaction(async (tx) => {
      const { rows } = await tx.query<UserRow>(
        `INSERT INTO users (company_id, email, password_hash, role, is_active)
         VALUES ($1, lower($2), $3, 'member', true)
         RETURNING id, email, role, is_active, created_at`,
        [auth.companyId, input.email.trim(), passwordHash],
      );
      const user = rows[0];
      await recordAdminAudit(tx, auth, { targetUserId: user.id, action: 'user_created', newValue: user.role });
      log.info('user_created', { actor: auth.userId, company: auth.companyId, userId: user.id });
      return toDto(user);
    });
  } catch (err) {
    // Unique violation on email. Emails are global, so this can reveal that an
    // email exists somewhere; accepted for a demo (documented in README).
    // The transaction above has already rolled back: no user row, no audit row.
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'Email already in use');
    throw err;
  }
}

export async function changeRole(auth: AuthContext, targetId: string, role: Role): Promise<UserDto> {
  requireUserManager(auth);
  if (!isUuid(targetId)) throw notFound();
  rejectSelfChange(auth, targetId, 'role');
  await throttleAdminMutation(auth);
  return withTransaction(async (tx) => {
    // FOR UPDATE: locks the target row for the rest of this transaction, so
    // the old-role read used for the audit entry can't race a concurrent
    // change to the same user (and serializes two role changes on one user,
    // which the row-level company_id filter alone would not do).
    const { rows: before } = await tx.query<{ role: Role }>(
      'SELECT role FROM users WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [targetId, auth.companyId],
    );
    if (!before[0]) throw notFound();
    const oldRole = before[0].role;
    const { rows } = await tx.query<UserRow>(
      `UPDATE users SET role = $3 WHERE id = $1 AND company_id = $2
       RETURNING id, email, role, is_active, created_at`,
      [targetId, auth.companyId, role],
    );
    const user = rows[0];
    // No session update needed: role is read from `users` on every request.
    // Audit only an actual change, not a same-value PUT.
    if (oldRole !== role) {
      await recordAdminAudit(tx, auth, { targetUserId: targetId, action: 'role_changed', oldValue: oldRole, newValue: role });
    }
    log.info('user_role_changed', { actor: auth.userId, company: auth.companyId, userId: targetId, role });
    return toDto(user);
  });
}

export async function setUserActive(auth: AuthContext, targetId: string, isActive: boolean): Promise<UserDto> {
  requireUserManager(auth);
  if (!isUuid(targetId)) throw notFound();
  rejectSelfChange(auth, targetId, 'active status');
  await throttleAdminMutation(auth);
  return withTransaction(async (tx) => {
    const { rows: before } = await tx.query<{ is_active: boolean }>(
      'SELECT is_active FROM users WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [targetId, auth.companyId],
    );
    if (!before[0]) throw notFound();
    const wasActive = before[0].is_active;
    const { rows } = await tx.query<UserRow>(
      `UPDATE users SET is_active = $3 WHERE id = $1 AND company_id = $2
       RETURNING id, email, role, is_active, created_at`,
      [targetId, auth.companyId, isActive],
    );
    const user = rows[0];
    if (!isActive) {
      // Two independent layers: (1) resolveSession() rejects inactive users on every
      // request, and (2) we also delete their sessions so reactivation does not
      // revive old (possibly stolen) tokens. Both happen in this transaction: a
      // deactivation and its session wipe either both commit or neither does.
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [targetId]);
    }
    if (wasActive !== isActive) {
      await recordAdminAudit(tx, auth, {
        targetUserId: targetId,
        action: 'active_changed',
        oldValue: String(wasActive),
        newValue: String(isActive),
      });
    }
    log.info('user_active_changed', { actor: auth.userId, company: auth.companyId, userId: targetId, isActive });
    return toDto(user);
  });
}
