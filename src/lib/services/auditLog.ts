import 'server-only';
import type { TxQuery } from '../db';
import { query } from '../db';
import { forbidden } from '../errors';
import { cursorTsSql, toPage, type Page, type PageRequest } from '../pagination';
import { canManageUsers, type Actor } from '../permissions';

export type AdminAuditAction = 'user_created' | 'role_changed' | 'active_changed';

export interface AuditEntryDto {
  id: string;
  actorUserId: string;
  targetUserId: string;
  action: AdminAuditAction;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

interface AuditRow {
  id: string;
  actor_user_id: string;
  target_user_id: string;
  action: AdminAuditAction;
  old_value: string | null;
  new_value: string | null;
  created_at: Date;
}

function toDto(r: AuditRow): AuditEntryDto {
  return {
    id: r.id,
    actorUserId: r.actor_user_id,
    targetUserId: r.target_user_id,
    action: r.action,
    oldValue: r.old_value,
    newValue: r.new_value,
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * Record one admin audit entry. Takes `tx` so the caller always writes this
 * in the SAME transaction as the mutation it documents: if the transaction
 * rolls back, the audit row rolls back with it, and if this insert itself
 * fails, the mutation rolls back too. company_id/actor_user_id come from the
 * server-derived `auth`, never from client input.
 */
export async function recordAdminAudit(
  tx: TxQuery,
  auth: { companyId: string; userId: string },
  entry: { targetUserId: string; action: AdminAuditAction; oldValue?: string | null; newValue?: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO admin_audit_log (company_id, actor_user_id, target_user_id, action, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.companyId, auth.userId, entry.targetUserId, entry.action, entry.oldValue ?? null, entry.newValue ?? null],
  );
}

/** One page of the caller's company audit log, newest-filtered by keyset on (created_at, id). Admin only. */
export async function listAuditLog(auth: Actor & { companyId: string }, page: PageRequest): Promise<Page<AuditEntryDto>> {
  if (!canManageUsers(auth)) throw forbidden('Admin role required');
  const params: unknown[] = [auth.companyId, page.limit + 1];
  let seek = '';
  if (page.after) {
    params.push(page.after.createdAt, page.after.id);
    seek = 'AND (created_at, id) > ($3::timestamptz, $4::uuid)';
  }
  const { rows } = await query<AuditRow & { cursor_ts: string }>(
    `SELECT id, actor_user_id, target_user_id, action, old_value, new_value, created_at,
            ${cursorTsSql('created_at')} AS cursor_ts
       FROM admin_audit_log
      WHERE company_id = $1 ${seek}
      ORDER BY created_at, id
      LIMIT $2`,
    params,
  );
  return toPage(rows, page.limit, toDto);
}
