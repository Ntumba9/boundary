// Unit tests for the permission matrix (pure functions, no DB, no server).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canCreateDocument,
  canManageProjects,
  canManageUsers,
  canModifyDocument,
  canReadCompanyContent,
  isRole,
  type Actor,
} from '../../src/lib/permissions.ts';

const admin: Actor = { userId: 'u-admin', role: 'admin' };
const member: Actor = { userId: 'u-member', role: 'member' };

test('members and admins can read and create in their company', () => {
  for (const a of [admin, member]) {
    assert.equal(canReadCompanyContent(a), true);
    assert.equal(canCreateDocument(a), true);
  }
});

test('member may modify only own documents', () => {
  assert.equal(canModifyDocument(member, { ownerUserId: 'u-member' }), true);
  assert.equal(canModifyDocument(member, { ownerUserId: 'someone-else' }), false);
});

test('admin may modify any document (tenancy is enforced separately in SQL)', () => {
  assert.equal(canModifyDocument(admin, { ownerUserId: 'someone-else' }), true);
});

test('only admins manage projects and users', () => {
  assert.equal(canManageProjects(admin), true);
  assert.equal(canManageUsers(admin), true);
  assert.equal(canManageProjects(member), false);
  assert.equal(canManageUsers(member), false);
});

test('isRole rejects anything but the two roles', () => {
  assert.equal(isRole('admin'), true);
  assert.equal(isRole('member'), true);
  for (const v of ['Admin', 'owner', '', null, undefined, 1]) assert.equal(isRole(v), false);
});
