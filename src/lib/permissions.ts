// The permission matrix, as pure functions. Mirrors the table in README.md.
//
// IMPORTANT: these functions decide what a role may do *within its own
// company*. They do not check tenancy. Tenancy is enforced separately and
// unconditionally by `company_id = $tenant` in every SQL query, so a bug here
// can at worst leak within a tenant, never across tenants.
//
// This file has no imports so it can be unit tested directly with node:test.

export type Role = 'admin' | 'member';

export interface Actor {
  userId: string;
  role: Role;
}

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'member';
}

/** Any active user may read documents and projects in their own company. */
export function canReadCompanyContent(actor: Actor): boolean {
  return isRole(actor.role);
}

/** Any active user may create documents in their own company's projects. */
export function canCreateDocument(actor: Actor): boolean {
  return isRole(actor.role);
}

/** Members may edit/delete only their own documents; admins may edit/delete any in their company. */
export function canModifyDocument(actor: Actor, doc: { ownerUserId: string }): boolean {
  return actor.role === 'admin' || doc.ownerUserId === actor.userId;
}

/** Create, rename, delete projects. */
export function canManageProjects(actor: Actor): boolean {
  return actor.role === 'admin';
}

/** List users, create users, change roles, deactivate/reactivate. */
export function canManageUsers(actor: Actor): boolean {
  return actor.role === 'admin';
}
