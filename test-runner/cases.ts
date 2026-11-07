// Authorization test cases. Each group starts from a freshly reseeded database.
//
// Every check prints/records: expected status, actual status, PASS/FAIL and a
// one-line explanation. Explanations must never contain tokens, cookies,
// passwords or document bodies.
//
// Positive controls (group 7 and several "precondition" checks) exist so that
// a server which simply denies everything FAILS this suite. Expected statuses
// are exact, so a 403/404 on an allowed action is a failure.
import type { ApiResult, BoundaryHttpAdapter, Session } from './adapter.ts';
import {
  COMPANIES,
  deactivateDirectlyInDb,
  DEMO_PASSWORD,
  DOCUMENTS,
  PROJECTS,
  RUNNER_USER_PASSWORD,
  runnerEmail,
  USERS,
} from './fixtures.ts';

export type Mode = 'safe' | 'unsafe-demo';

export interface CaseResult {
  id: string;
  group: string;
  name: string;
  expected: string;
  actual: string;
  result: 'PASS' | 'FAIL';
  explanation: string;
  /** True only for the single case the unsafe demo is designed to break, when it fails in unsafe mode. */
  intentionalFailure?: boolean;
}

/** The one case that unsafe demo mode is expected to break. */
export const UNSAFE_TARGET_CASE_ID = '1.1';

export interface GroupContext {
  api: BoundaryHttpAdapter;
  mode: Mode;
  /** Whether the DB can be manipulated directly (local target only). */
  dbAccess: boolean;
  check(c: {
    id: string;
    name: string;
    expected: number | number[];
    res: ApiResult | number;
    explanation: string;
    /** Additional assertion beyond the status code (e.g. "no foreign rows in list"). */
    extra?: { ok: boolean; detail: string };
  }): boolean;
  login(label: string, email: string, password?: string): Promise<Session>;
}

export interface CaseGroup {
  id: string;
  title: string;
  run(ctx: GroupContext): Promise<void>;
}

const A = USERS;
const D = DOCUMENTS;
const P = PROJECTS;

/** Shape of GET /api/admin/audit-log, used only by group 9 via ctx.api.raw. */
interface AuditEntry {
  id: string;
  actorUserId: string;
  targetUserId: string;
  action: 'user_created' | 'role_changed' | 'active_changed';
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}
interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

export const GROUPS: CaseGroup[] = [
  {
    id: '1',
    title: 'Cross-tenant reads (Globex member vs Acme data)',
    async run(ctx) {
      const gMember = await ctx.login('globex-member', A.globexMember.email);

      const r1 = await ctx.api.getDocument(gMember, D.acmeSkatesSpec.id);
      const leaked = JSON.stringify(r1.body ?? '').includes('CONFIDENTIAL (Acme)');
      ctx.check({
        id: UNSAFE_TARGET_CASE_ID,
        name: 'Globex member GETs an Acme document directly by id',
        expected: 404,
        res: r1,
        extra: { ok: !leaked, detail: 'response contained Acme confidential content' },
        explanation: leaked
          ? 'Cross-tenant read succeeded: Acme document content was returned to a Globex user (IDOR).'
          : 'Another company\'s document must look nonexistent (404), never 200 or 403.',
      });

      const r2 = await ctx.api.listDocuments(gMember, P.globexDoomsday.id);
      const rows = Array.isArray(r2.body) ? r2.body : [];
      const foreign = rows.filter((d) => d.companyId !== COMPANIES.globex.id);
      ctx.check({
        id: '1.2',
        name: 'Globex member lists documents in own project: zero Acme documents present',
        expected: 200,
        res: r2,
        extra: { ok: foreign.length === 0 && rows.length > 0, detail: `${foreign.length} foreign of ${rows.length} rows` },
        explanation: `Listing returned ${rows.length} documents, ${foreign.length} from another company (must be 0).`,
      });

      const r3 = await ctx.api.listDocuments(gMember, P.acmeRocketSkates.id);
      ctx.check({
        id: '1.3',
        name: 'Globex member lists documents of an Acme project',
        expected: 404,
        res: r3,
        explanation: 'Listing a foreign project\'s documents must 404 (project id not visible to this tenant).',
      });

      const r4 = await ctx.api.getProject(gMember, P.acmeRocketSkates.id);
      ctx.check({
        id: '1.4',
        name: 'Globex member GETs an Acme project by id',
        expected: 404,
        res: r4,
        explanation: 'Foreign project must not be revealed.',
      });
    },
  },
  {
    id: '2',
    title: 'Cross-tenant writes (Globex admin vs Acme project/documents)',
    async run(ctx) {
      const gAdmin = await ctx.login('globex-admin', A.globexAdmin.email);
      const aAdmin = await ctx.login('acme-admin', A.acmeAdmin.email);

      ctx.check({
        id: '2.1',
        name: 'Globex admin renames an Acme project',
        expected: 404,
        res: await ctx.api.updateProject(gAdmin, P.acmeAnvil.id, 'pwned'),
        explanation: 'Admin role is per-company; foreign project must 404.',
      });
      ctx.check({
        id: '2.2',
        name: 'Globex admin deletes an Acme project',
        expected: 404,
        res: await ctx.api.deleteProject(gAdmin, P.acmeAnvil.id),
        explanation: 'Admin role is per-company; foreign project must 404.',
      });
      ctx.check({
        id: '2.3',
        name: 'Globex admin edits an Acme document (admin override must not cross tenants)',
        expected: 404,
        res: await ctx.api.updateDocument(gAdmin, D.acmeAnvilBrief.id, { body: 'pwned' }),
        explanation: 'Admin override applies only within own company.',
      });
      ctx.check({
        id: '2.4',
        name: 'Globex admin deletes an Acme document',
        expected: 404,
        res: await ctx.api.deleteDocument(gAdmin, D.acmeAnvilQa.id),
        explanation: 'Admin override applies only within own company.',
      });
      ctx.check({
        id: '2.5',
        name: 'Globex admin creates a document inside an Acme project',
        expected: 404,
        res: await ctx.api.createDocument(gAdmin, P.acmeAnvil.id, { title: 'planted', body: 'x' }),
        explanation: 'Cannot plant data into another tenant.',
      });
      ctx.check({
        id: '2.6',
        name: 'Globex admin promotes an Acme member to admin',
        expected: 404,
        res: await ctx.api.changeRole(gAdmin, A.acmeMember.id, 'admin'),
        explanation: 'User management is scoped to own company.',
      });
      ctx.check({
        id: '2.7',
        name: 'Globex admin deactivates an Acme user',
        expected: 404,
        res: await ctx.api.deactivateUser(gAdmin, A.acmeMember.id),
        explanation: 'User management is scoped to own company.',
      });

      const after = await ctx.api.getProject(aAdmin, P.acmeAnvil.id);
      ctx.check({
        id: '2.8',
        name: 'Acme admin still sees the Acme project unchanged (no side effects)',
        expected: 200,
        res: after,
        extra: { ok: after.body?.name === P.acmeAnvil.name, detail: 'project name changed' },
        explanation: 'Positive control: the rejected cross-tenant writes left the project intact.',
      });
      const doc = await ctx.api.getDocument(aAdmin, D.acmeAnvilBrief.id);
      ctx.check({
        id: '2.9',
        name: 'Acme document body unchanged after Globex attempts',
        expected: 200,
        res: doc,
        extra: { ok: doc.body?.body === D.acmeAnvilBrief.body, detail: 'document body changed' },
        explanation: 'Positive control: document still readable by its own tenant and not modified.',
      });
    },
  },
  {
    id: '3',
    title: 'Member privilege limits (own company)',
    async run(ctx) {
      const member = await ctx.login('acme-member', A.acmeMember.email);
      const admin = await ctx.login('acme-admin', A.acmeAdmin.email);
      const why = 'Members cannot manage users or projects, even in their own company.';

      ctx.check({ id: '3.1', name: 'Member creates a user', expected: 403, res: await ctx.api.createUser(member, runnerEmail('m', 'acme'), RUNNER_USER_PASSWORD), explanation: why });
      ctx.check({ id: '3.2', name: 'Member promotes self to admin', expected: 403, res: await ctx.api.changeRole(member, A.acmeMember.id, 'admin'), explanation: why });
      ctx.check({ id: '3.3', name: 'Member demotes the admin', expected: 403, res: await ctx.api.changeRole(member, A.acmeAdmin.id, 'member'), explanation: why });
      ctx.check({ id: '3.4', name: 'Member deactivates the admin', expected: 403, res: await ctx.api.deactivateUser(member, A.acmeAdmin.id), explanation: why });
      ctx.check({ id: '3.5', name: 'Member deletes an own-company project', expected: 403, res: await ctx.api.deleteProject(member, P.acmePortableHoles.id), explanation: why });
      ctx.check({ id: '3.6', name: 'Member creates a project', expected: 403, res: await ctx.api.createProject(member, 'unauthorized'), explanation: why });
      ctx.check({ id: '3.7', name: 'Member lists company users', expected: 403, res: await ctx.api.listUsers(member), explanation: why });

      const me = await ctx.api.me(member);
      ctx.check({
        id: '3.8',
        name: 'Member is still a member after the attempts',
        expected: 200,
        res: me,
        extra: { ok: me.body?.role === 'member', detail: `role is ${String(me.body?.role)}` },
        explanation: 'Positive control: authenticated, role unchanged.',
      });
      ctx.check({
        id: '3.9',
        name: 'Project still exists after member delete attempt',
        expected: 200,
        res: await ctx.api.getProject(admin, P.acmePortableHoles.id),
        explanation: 'Positive control: the forbidden delete had no effect.',
      });
    },
  },
  {
    id: '4',
    title: 'Ownership within a company',
    async run(ctx) {
      const admin = await ctx.login('acme-admin', A.acmeAdmin.email);
      const member = await ctx.login('acme-member', A.acmeMember.email);

      // Setup: a second member who owns a document.
      const email = runnerEmail('member2', 'acme');
      const created = await ctx.api.createUser(admin, email, RUNNER_USER_PASSWORD);
      if (created.status !== 201) throw new Error(`setup: admin could not create second member (status ${created.status})`);
      const member2 = await ctx.login('acme-member2', email, RUNNER_USER_PASSWORD);
      const doc = await ctx.api.createDocument(member2, P.acmeRocketSkates.id, { title: 'Member2 notes', body: 'original' });
      if (doc.status !== 201 || !doc.body) throw new Error(`setup: second member could not create a document (status ${doc.status})`);
      const docId = doc.body.id;

      ctx.check({ id: '4.1', name: "Member edits another member's document", expected: 403, res: await ctx.api.updateDocument(member, docId, { body: 'tampered' }), explanation: 'Members may edit only documents they own.' });
      ctx.check({ id: '4.2', name: "Member deletes another member's document", expected: 403, res: await ctx.api.deleteDocument(member, docId), explanation: 'Members may delete only documents they own.' });
      ctx.check({ id: '4.3', name: "Member edits the admin's document", expected: 403, res: await ctx.api.updateDocument(member, D.acmeSkatesSpec.id, { title: 'tampered' }), explanation: 'Ownership applies regardless of who the owner is.' });

      const read = await ctx.api.getDocument(member, docId);
      ctx.check({
        id: '4.4',
        name: "Member can still READ the other member's document, unchanged",
        expected: 200,
        res: read,
        extra: { ok: read.body?.body === 'original', detail: 'body was modified' },
        explanation: 'Positive control: same-company read is allowed; rejected edit left it intact.',
      });
    },
  },
  {
    id: '5',
    title: 'Deactivation revokes existing sessions immediately',
    async run(ctx) {
      const admin = await ctx.login('acme-admin', A.acmeAdmin.email);
      const member = await ctx.login('acme-member', A.acmeMember.email);

      ctx.check({ id: '5.1', name: 'Precondition: member session works', expected: 200, res: await ctx.api.me(member), explanation: 'Positive control: session valid before deactivation.' });
      ctx.check({ id: '5.2', name: 'Admin deactivates the member', expected: 200, res: await ctx.api.deactivateUser(admin, A.acmeMember.id), explanation: 'Positive control: admin may deactivate users in own company.' });
      ctx.check({ id: '5.3', name: 'Old member session calls /api/me', expected: 401, res: await ctx.api.me(member), explanation: 'Same cookie, unexpired, but user is inactive: must be rejected now, not at next login.' });
      ctx.check({ id: '5.4', name: 'Old member session reads a document', expected: 401, res: await ctx.api.getDocument(member, D.acmeSkatesBudget.id), explanation: 'Revocation covers every endpoint.' });
      const relogin = await ctx.api.login('acme-member-again', A.acmeMember.email, DEMO_PASSWORD);
      ctx.check({ id: '5.5', name: 'Deactivated member tries to log in again', expected: 401, res: relogin.status, explanation: 'Deactivated accounts cannot obtain new sessions.' });

      if (ctx.dbAccess) {
        // Second layer, tested in isolation: deactivate directly in the DB WITHOUT
        // deleting sessions, so only the per-request is_active check can stop it.
        const gMember = await ctx.login('globex-member', A.globexMember.email);
        ctx.check({ id: '5.6', name: 'Precondition: Globex member session works', expected: 200, res: await ctx.api.me(gMember), explanation: 'Positive control before direct DB deactivation.' });
        const { unexpiredSessions } = await deactivateDirectlyInDb(A.globexMember.id);
        ctx.check({
          id: '5.7',
          name: 'User deactivated in DB (session rows left intact) is rejected',
          expected: 401,
          res: await ctx.api.me(gMember),
          extra: { ok: unexpiredSessions > 0, detail: 'precondition failed: no unexpired session row existed' },
          explanation: `Session row still present and unexpired (${unexpiredSessions}); is_active is checked on every request.`,
        });
      }
    },
  },
  {
    id: '6',
    title: 'Demotion takes effect immediately',
    async run(ctx) {
      const admin = await ctx.login('acme-admin', A.acmeAdmin.email);
      const email = runnerEmail('admin2', 'acme');
      const created = await ctx.api.createUser(admin, email, RUNNER_USER_PASSWORD);
      if (created.status !== 201 || !created.body) throw new Error(`setup: could not create second admin (status ${created.status})`);
      const admin2Id = created.body.id;
      const promote = await ctx.api.changeRole(admin, admin2Id, 'admin');
      if (promote.status !== 200) throw new Error(`setup: could not promote second admin (status ${promote.status})`);
      const admin2 = await ctx.login('acme-admin2', email, RUNNER_USER_PASSWORD);

      ctx.check({ id: '6.1', name: 'Precondition: second admin can list users', expected: 200, res: await ctx.api.listUsers(admin2), explanation: 'Positive control: admin action works before demotion.' });
      ctx.check({ id: '6.2', name: 'First admin demotes second admin to member', expected: 200, res: await ctx.api.changeRole(admin, admin2Id, 'member'), explanation: 'Positive control: admin may change roles in own company.' });
      ctx.check({ id: '6.3', name: 'Demoted user (same session) lists users', expected: 403, res: await ctx.api.listUsers(admin2), explanation: 'Role is re-read on every request; old session has no admin rights.' });
      ctx.check({ id: '6.4', name: 'Demoted user (same session) creates a user', expected: 403, res: await ctx.api.createUser(admin2, runnerEmail('x', 'acme'), RUNNER_USER_PASSWORD), explanation: 'Admin-only action now forbidden.' });
      ctx.check({ id: '6.5', name: 'Demoted user (same session) deletes a project', expected: 403, res: await ctx.api.deleteProject(admin2, P.acmeAnvil.id), explanation: 'Admin-only action now forbidden.' });
      const me = await ctx.api.me(admin2);
      ctx.check({
        id: '6.6',
        name: 'Demoted user is still authenticated, now as member',
        expected: 200,
        res: me,
        extra: { ok: me.body?.role === 'member', detail: `role is ${String(me.body?.role)}` },
        explanation: 'Demotion is 403 (authorization), not 401 (authentication).',
      });
    },
  },
  {
    id: '7',
    title: 'Positive controls (a deny-everything server must fail these)',
    async run(ctx) {
      const member = await ctx.login('acme-member', A.acmeMember.email);
      const admin = await ctx.login('acme-admin', A.acmeAdmin.email);
      const gMember = await ctx.login('globex-member', A.globexMember.email);
      const note = 'Must be allowed: a 403/404 here means the server is over-denying.';

      ctx.check({ id: '7.1', name: "Member reads the admin's document in own company", expected: 200, res: await ctx.api.getDocument(member, D.acmeSkatesSpec.id), explanation: note });
      const list = await ctx.api.listDocuments(member, P.acmeRocketSkates.id);
      ctx.check({
        id: '7.2',
        name: 'Member lists documents in own project',
        expected: 200,
        res: list,
        extra: { ok: Array.isArray(list.body) && list.body.length >= 3, detail: 'expected the seeded documents' },
        explanation: note,
      });
      const own = await ctx.api.updateDocument(member, D.acmeSkatesBudget.id, { body: 'Updated by owner' });
      ctx.check({
        id: '7.3',
        name: 'Owner (member) edits own document',
        expected: 200,
        res: own,
        extra: { ok: own.body?.body === 'Updated by owner', detail: 'edit not applied' },
        explanation: note,
      });
      const created = await ctx.api.createDocument(member, P.acmeAnvil.id, { title: 'Member doc', body: 'hello' });
      ctx.check({
        id: '7.4',
        name: 'Member creates a document in own company project',
        expected: 201,
        res: created,
        extra: {
          ok: created.body?.ownerUserId === A.acmeMember.id && created.body?.companyId === COMPANIES.acme.id,
          detail: 'owner/company not derived from session',
        },
        explanation: 'Owner and company are set server-side from the session.',
      });
      ctx.check({ id: '7.5', name: 'Admin creates a user in own company', expected: 201, res: await ctx.api.createUser(admin, runnerEmail('new', 'acme'), RUNNER_USER_PASSWORD), explanation: note });
      const override = await ctx.api.updateDocument(admin, D.acmeAnvilQa.id, { body: 'Edited by admin' });
      ctx.check({
        id: '7.6',
        name: "Admin edits a member's document (admin override)",
        expected: 200,
        res: override,
        extra: { ok: override.body?.body === 'Edited by admin', detail: 'edit not applied' },
        explanation: note,
      });
      const proj = await ctx.api.createProject(admin, 'Runner project');
      ctx.check({ id: '7.7', name: 'Admin creates a project', expected: 201, res: proj, explanation: note });
      if (proj.body?.id) {
        ctx.check({ id: '7.8', name: 'Admin deletes that project', expected: 200, res: await ctx.api.deleteProject(admin, proj.body.id), explanation: note });
      }
      ctx.check({ id: '7.9', name: 'Owner (member) deletes own document', expected: 200, res: await ctx.api.deleteDocument(member, D.acmeHolesRisks.id), explanation: note });
      ctx.check({ id: '7.10', name: 'Globex member reads own company document', expected: 200, res: await ctx.api.getDocument(gMember, D.globexDoomsdayPlan.id), explanation: 'Tenant B works normally too; isolation is not "B is broken".' });
    },
  },
  {
    id: '8',
    title: 'Defense extras (mass assignment, CSRF, auth, validation, throttling)',
    async run(ctx) {
      const member = await ctx.login('acme-member', A.acmeMember.email);

      ctx.check({
        id: '8.1',
        name: 'Create document with company_id of another tenant in body',
        expected: 400,
        res: await ctx.api.raw(member, 'POST', `/api/projects/${P.acmeAnvil.id}/documents`, {
          body: { title: 't', body: 'b', company_id: COMPANIES.globex.id },
        }),
        explanation: 'Mass assignment: unknown fields are rejected, company_id is never client-settable.',
      });
      ctx.check({
        id: '8.2',
        name: 'Update own document with owner_user_id in body',
        expected: 400,
        res: await ctx.api.raw(member, 'PATCH', `/api/documents/${D.acmeSkatesBudget.id}`, {
          body: { body: 'x', owner_user_id: A.acmeAdmin.id },
        }),
        explanation: 'Mass assignment: owner_user_id is never client-settable.',
      });
      ctx.check({
        id: '8.3',
        name: 'Mutation without CSRF header',
        expected: 403,
        res: await ctx.api.raw(member, 'PATCH', `/api/documents/${D.acmeSkatesBudget.id}`, { body: { body: 'x' }, csrf: 'omit' }),
        explanation: 'Cookie-authenticated mutations require the double-submit CSRF token.',
      });
      ctx.check({
        id: '8.4',
        name: 'Mutation with wrong CSRF token',
        expected: 403,
        res: await ctx.api.raw(member, 'PATCH', `/api/documents/${D.acmeSkatesBudget.id}`, { body: { body: 'x' }, csrf: { value: '0'.repeat(64) } }),
        explanation: 'Header must match the cookie and the hash stored on the session.',
      });
      ctx.check({
        id: '8.5',
        name: 'Request with no session cookie',
        expected: 401,
        res: await ctx.api.raw(null, 'GET', '/api/projects'),
        explanation: 'No session: 401.',
      });
      ctx.check({
        id: '8.6',
        name: 'Request with a forged session token',
        expected: 401,
        res: await ctx.api.raw(member, 'GET', '/api/projects', { sessionCookieOverride: 'f'.repeat(64) }),
        explanation: 'Unknown token hash: 401.',
      });
      ctx.check({
        id: '8.7',
        name: 'Create document with empty title',
        expected: 400,
        res: await ctx.api.createDocument(member, P.acmeAnvil.id, { title: '   ', body: 'x' }),
        explanation: 'zod validation rejects invalid input with 400.',
      });

      const probe = runnerEmail('throttle', 'acme');
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await ctx.api.login('throttle', probe, 'wrong-password')).status);
      const sixth = await ctx.api.login('throttle', probe, 'wrong-password');
      ctx.check({
        id: '8.8',
        name: 'Sixth login attempt after 5 failures is throttled',
        expected: 429,
        res: sixth.status,
        extra: { ok: statuses.every((s) => s === 401), detail: `first five were ${statuses.join(',')}` },
        explanation: 'Basic per-email+IP lockout after repeated failures.',
      });

      ctx.check({
        id: '8.9',
        name: 'JSON body above the 64 KB declared-size cap',
        expected: 413,
        res: await ctx.api.raw(member, 'POST', `/api/projects/${P.acmeAnvil.id}/documents`, {
          body: { title: 't', body: 'x'.repeat(70 * 1024) },
        }),
        explanation: 'Oversized bodies are rejected before they are buffered and parsed.',
      });
      ctx.check({
        id: '8.10',
        name: 'Logout with an already-expired session',
        expected: 200,
        res: await ctx.api.raw(
          {
            label: 'stale-session',
            cookies: new Map([
              ['boundary_session', 'e'.repeat(64)],
              ['boundary_csrf', '0'.repeat(64)],
            ]),
            csrfToken: '0'.repeat(64),
          },
          'POST',
          '/api/auth/logout',
        ),
        explanation: 'Logout must still succeed (and clear the cookies) when the session is already gone server-side.',
      });
      ctx.check({
        id: '8.11',
        name: 'Logout without the CSRF header (live session)',
        expected: 403,
        res: await ctx.api.raw(member, 'POST', '/api/auth/logout', { csrf: 'omit' }),
        explanation: 'A valid session still needs the double-submit token to log out.',
      });
      ctx.check({
        id: '8.12',
        name: 'Chunked body (no Content-Length) above the 64 KB cap',
        expected: 413,
        res: await ctx.api.raw(member, 'POST', `/api/projects/${P.acmeAnvil.id}/documents`, {
          body: { title: 't', body: 'x'.repeat(70 * 1024) },
          chunked: true,
        }),
        explanation: 'The body cap bounds the stream itself; a missing or forged Content-Length cannot bypass it.',
      });

      const burstKey = runnerEmail('throttle-parallel', 'acme');
      const burst = await Promise.all(
        Array.from({ length: 12 }, () => ctx.api.login('throttle-parallel', burstKey, 'wrong-password')),
      );
      const afterBurst = await ctx.api.login('throttle-parallel', burstKey, 'wrong-password');
      ctx.check({
        id: '8.13',
        name: 'Twelve parallel failed logins still trigger the lockout',
        expected: 429,
        res: afterBurst.status,
        extra: {
          ok: burst.every((r) => r.status === 401 || r.status === 429),
          detail: `burst statuses: ${burst.map((r) => r.status).join(',')}`,
        },
        explanation: 'The lock engages atomically at the threshold even under concurrent failures; no 500s.',
      });
    },
  },
  {
    id: '9',
    title: 'Admin audit log and admin-mutation rate limiting',
    async run(ctx) {
      const admin = await ctx.login('acme-admin', A.acmeAdmin.email);
      const member = await ctx.login('acme-member', A.acmeMember.email);
      const gAdmin = await ctx.login('globex-admin', A.globexAdmin.email);

      const auditLog = (s: Session) => ctx.api.raw<AuditPage>(s, 'GET', '/api/admin/audit-log');

      // --- successful mutations are audited -------------------------------
      const newEmail = runnerEmail('audit-new', 'acme');
      const created = await ctx.api.createUser(admin, newEmail, RUNNER_USER_PASSWORD);
      if (created.status !== 201 || !created.body) throw new Error(`setup: could not create user (status ${created.status})`);
      const newUserId = created.body.id;

      const afterCreate = await auditLog(admin);
      const createEntry = afterCreate.body?.items.find((e) => e.targetUserId === newUserId && e.action === 'user_created');
      ctx.check({
        id: '9.1',
        name: 'Successful user creation writes an audit entry',
        expected: 201,
        res: created.status,
        extra: {
          ok: !!createEntry && createEntry.actorUserId === A.acmeAdmin.id && createEntry.newValue === 'member',
          detail: `entry: ${JSON.stringify(createEntry ?? null)}`,
        },
        explanation: 'The audit row records actor, target and the assigned role, written in the same transaction as the insert.',
      });

      const roleChange = await ctx.api.changeRole(admin, newUserId, 'admin');
      const afterRole = await auditLog(admin);
      const roleEntry = afterRole.body?.items.find((e) => e.targetUserId === newUserId && e.action === 'role_changed');
      ctx.check({
        id: '9.2',
        name: 'Successful role change writes an audit entry with old and new role',
        expected: 200,
        res: roleChange.status,
        extra: {
          ok: roleEntry?.oldValue === 'member' && roleEntry?.newValue === 'admin',
          detail: `entry: ${JSON.stringify(roleEntry ?? null)}`,
        },
        explanation: 'old_value/new_value capture the transition, read from the row under FOR UPDATE in the same transaction as the write.',
      });

      const deactivate = await ctx.api.deactivateUser(admin, newUserId);
      const afterActive = await auditLog(admin);
      const activeEntry = afterActive.body?.items.find((e) => e.targetUserId === newUserId && e.action === 'active_changed');
      ctx.check({
        id: '9.3',
        name: 'Successful deactivation writes an audit entry with old and new status',
        expected: 200,
        res: deactivate.status,
        extra: {
          ok: activeEntry?.oldValue === 'true' && activeEntry?.newValue === 'false',
          detail: `entry: ${JSON.stringify(activeEntry ?? null)}`,
        },
        explanation: 'Deactivation, its session wipe and its audit entry commit in one transaction.',
      });

      // --- rollback: a failed mutation must not leave an audit entry ------
      const countBeforeDup = (await auditLog(admin)).body?.items.length ?? -1;
      const dup = await ctx.api.createUser(admin, A.acmeMember.email, RUNNER_USER_PASSWORD);
      const countAfterDup = (await auditLog(admin)).body?.items.length ?? -1;
      ctx.check({
        id: '9.4',
        name: 'Duplicate-email creation fails and leaves no audit entry (rollback)',
        expected: 409,
        res: dup.status,
        extra: {
          ok: countBeforeDup >= 0 && countAfterDup === countBeforeDup,
          detail: `audit entries before=${countBeforeDup} after=${countAfterDup}`,
        },
        explanation: 'The insert fails on the unique-email constraint; the whole transaction rolls back, so the audit insert never commits either.',
      });

      // --- forbidden: a member cannot mutate, and nothing is recorded ----
      const forbidden = await ctx.api.changeRole(member, A.acmeAdmin.id, 'member');
      const adminRoleAfter = (await ctx.api.listUsers(admin)).body?.find((u) => u.id === A.acmeAdmin.id)?.role;
      const forbiddenEntry = (await auditLog(admin)).body?.items.find((e) => e.targetUserId === A.acmeAdmin.id && e.action === 'role_changed');
      ctx.check({
        id: '9.5',
        name: 'Member cannot change a role: no mutation, no audit entry',
        expected: 403,
        res: forbidden.status,
        extra: {
          ok: adminRoleAfter === 'admin' && !forbiddenEntry,
          detail: `acmeAdmin role after attempt: ${String(adminRoleAfter)}, matching audit entry: ${JSON.stringify(forbiddenEntry ?? null)}`,
        },
        explanation: 'Permission is checked before the throttle or the transaction: a forbidden caller never reaches either.',
      });

      // --- cross-tenant: 404, no mutation, no audit entry -----------------
      const crossTenant = await ctx.api.deactivateUser(admin, A.globexMember.id);
      const globexMemberAfter = (await ctx.api.listUsers(gAdmin)).body?.find((u) => u.id === A.globexMember.id)?.isActive;
      const crossTenantEntry = (await auditLog(admin)).body?.items.find((e) => e.targetUserId === A.globexMember.id);
      ctx.check({
        id: '9.6',
        name: "Admin cannot deactivate another company's user: 404, no mutation, no audit entry",
        expected: 404,
        res: crossTenant.status,
        extra: {
          ok: globexMemberAfter === true && !crossTenantEntry,
          detail: `globex member isActive after attempt: ${String(globexMemberAfter)}, matching audit entry: ${JSON.stringify(crossTenantEntry ?? null)}`,
        },
        explanation: 'The UPDATE is scoped by company_id in SQL; it matches zero rows, so there is nothing to audit either.',
      });

      // --- the read endpoint itself: admin-only and tenant-isolated ------
      ctx.check({
        id: '9.7',
        name: 'Member cannot read the audit log',
        expected: 403,
        res: await auditLog(member),
        explanation: 'Same admin-only rule as every other admin endpoint.',
      });

      const gNewEmail = runnerEmail('audit-globex', 'globex');
      const gCreated = await ctx.api.createUser(gAdmin, gNewEmail, RUNNER_USER_PASSWORD);
      if (gCreated.status !== 201 || !gCreated.body) throw new Error(`setup: could not create Globex user (status ${gCreated.status})`);
      const acmeView = await auditLog(admin);
      const leaked = acmeView.body?.items.some((e) => e.actorUserId === A.globexAdmin.id || e.targetUserId === gCreated.body!.id);
      ctx.check({
        id: '9.8',
        name: "Acme admin's audit log contains no Globex entries",
        expected: 200,
        res: acmeView,
        extra: { ok: !leaked, detail: leaked ? 'a Globex actor/target id appeared in the Acme audit log' : 'no cross-tenant rows' },
        explanation: 'The listing is filtered by company_id in SQL, the same as every other list endpoint.',
      });

      // --- rate limit: prove the allowed COUNT, not just that one request is 429 ---
      // A fresh admin, created and promoted here, so its mutation budget is
      // untouched by everything above (the limit is per actor, not per
      // endpoint or group). MAX below must match MAX_ADMIN_MUTATIONS in
      // src/lib/auth/adminThrottle.ts.
      const MAX = 10;
      const burstEmail = runnerEmail('burst-admin', 'acme');
      const burstCreated = await ctx.api.createUser(admin, burstEmail, RUNNER_USER_PASSWORD);
      if (burstCreated.status !== 201 || !burstCreated.body) throw new Error(`setup: could not create burst admin (status ${burstCreated.status})`);
      const burstPromote = await ctx.api.changeRole(admin, burstCreated.body.id, 'admin');
      if (burstPromote.status !== 200) throw new Error(`setup: could not promote burst admin (status ${burstPromote.status})`);
      const burstAdmin = await ctx.login('acme-burst-admin', burstEmail, RUNNER_USER_PASSWORD);

      const attempts = MAX + 5;
      const burst = await Promise.all(
        Array.from({ length: attempts }, () => ctx.api.createUser(burstAdmin, runnerEmail('burst', 'acme'), RUNNER_USER_PASSWORD)),
      );
      const succeeded = burst.filter((r) => r.status === 201).length;
      const throttled = burst.filter((r) => r.status === 429).length;
      ctx.check({
        id: '9.9',
        name: `${attempts} parallel admin mutations from one fresh admin: exactly ${MAX} succeed`,
        expected: MAX,
        res: succeeded,
        extra: {
          ok: succeeded === MAX && throttled === attempts - MAX && succeeded + throttled === attempts,
          detail: `succeeded=${succeeded} throttled=${throttled} other=${attempts - succeeded - throttled}`,
        },
        explanation: 'The atomic per-(company,actor) counter admits exactly the limit, under concurrency, and rejects the rest with 429 -- not "one request got 429", the exact allowed count.',
      });
    },
  },
  {
    id: '10',
    title: 'Request correlation ids (X-Request-ID)',
    async run(ctx) {
      const member = await ctx.login('acme-member', A.acmeMember.email);
      const idRe = /^[A-Za-z0-9._-]{1,128}$/;

      // --- success path: every authenticated response carries one ---------
      const ok = await ctx.api.raw(member, 'GET', '/api/me');
      ctx.check({
        id: '10.1',
        name: 'A normal authenticated response carries X-Request-ID',
        expected: 200,
        res: ok,
        extra: { ok: !!ok.requestId && idRe.test(ok.requestId), detail: `requestId: ${JSON.stringify(ok.requestId)}` },
        explanation: 'authed() stamps X-Request-ID on every response, success or failure.',
      });

      // --- a well-formed caller-supplied id is honored verbatim -----------
      const clientId = 'client-supplied-id-123';
      const echoed = await ctx.api.raw(member, 'GET', '/api/me', { extraHeaders: { 'x-request-id': clientId } });
      ctx.check({
        id: '10.2',
        name: 'A well-formed caller-supplied X-Request-ID is echoed back',
        expected: 200,
        res: echoed,
        extra: { ok: echoed.requestId === clientId, detail: `sent ${clientId}, got back ${JSON.stringify(echoed.requestId)}` },
        explanation: 'A safe, bounded id from the caller is trusted for correlation across a gateway or load balancer.',
      });

      // --- an unsafe caller-supplied id is never reflected -----------------
      // A literal CR/LF can't even be placed in this request: the Fetch
      // standard's header-value validation (undici here, every browser too)
      // refuses to send one -- that part of the injection vector is already
      // closed by the HTTP client, not by this app. What a conformant client
      // CAN send is a value with other characters outside the app's safe set
      // (spaces, quotes, markup); this proves the server validates on its own
      // and does not just rely on well-behaved clients.
      const injected = await ctx.api.raw(member, 'GET', '/api/me', {
        extraHeaders: { 'x-request-id': 'not safe; has "quotes" <tags> and spaces' },
      });
      ctx.check({
        id: '10.3',
        name: 'An unsafe caller-supplied X-Request-ID (outside the safe character set) is replaced, never reflected',
        expected: 200,
        res: injected,
        extra: {
          ok: !!injected.requestId && idRe.test(injected.requestId),
          detail: `got back ${JSON.stringify(injected.requestId)}`,
        },
        explanation: 'The incoming id is validated against a safe character set before reuse; an unsafe value is discarded and a fresh server id is generated, so it can never inject a header or a log line.',
      });

      const tooLong = await ctx.api.raw(member, 'GET', '/api/me', { extraHeaders: { 'x-request-id': 'x'.repeat(200) } });
      ctx.check({
        id: '10.4',
        name: 'An over-length caller-supplied X-Request-ID is replaced, not truncated and reused',
        expected: 200,
        res: tooLong,
        extra: {
          ok: !!tooLong.requestId && idRe.test(tooLong.requestId) && tooLong.requestId.length <= 128,
          detail: `got back length ${tooLong.requestId?.length ?? 'null'}`,
        },
        explanation: "Oversized ids are rejected outright rather than truncated, which would silently merge two different callers' ids.",
      });

      // --- error paths still carry the id, in both the header and the body ---
      // A well-formed but guaranteed-unseeded UUID: a clean 404, not a
      // different-shape "not a UUID" 404 (see src/lib/errors.ts, isUuid).
      const NIL_UUID = '00000000-0000-0000-0000-000000000000';
      const notFound = await ctx.api.raw(member, 'GET', `/api/documents/${NIL_UUID}`);
      const notFoundBody = notFound.body as { requestId?: string } | null;
      ctx.check({
        id: '10.5',
        name: '404 response still carries X-Request-ID, matching in header and body',
        expected: 404,
        res: notFound,
        extra: {
          ok: !!notFound.requestId && notFoundBody?.requestId === notFound.requestId,
          detail: `header=${JSON.stringify(notFound.requestId)} body=${JSON.stringify(notFoundBody?.requestId)}`,
        },
        explanation: 'errorResponse() stamps the same id used for the header into the JSON error body, so a reported failure can be found in the logs by that id alone.',
      });

      const validation = await ctx.api.raw(member, 'POST', `/api/projects/${P.acmeAnvil.id}/documents`, {
        body: { title: '', body: 'x' },
      });
      const validationBody = validation.body as { requestId?: string } | null;
      ctx.check({
        id: '10.6',
        name: '400 validation failure still carries X-Request-ID, matching in header and body',
        expected: 400,
        res: validation,
        extra: {
          ok: !!validation.requestId && validationBody?.requestId === validation.requestId,
          detail: `header=${JSON.stringify(validation.requestId)} body=${JSON.stringify(validationBody?.requestId)}`,
        },
        explanation: 'zod validation errors go through the same errorResponse() path, so they carry the id too.',
      });

      const unauthenticated = await ctx.api.raw(null, 'GET', '/api/projects');
      ctx.check({
        id: '10.7',
        name: '401 (no session) still carries X-Request-ID',
        expected: 401,
        res: unauthenticated,
        extra: { ok: !!unauthenticated.requestId && idRe.test(unauthenticated.requestId), detail: `requestId: ${JSON.stringify(unauthenticated.requestId)}` },
        explanation: 'The id is assigned before authentication runs, so even a rejected request is traceable.',
      });

      // --- generated ids are not a static or predictable value -------------
      const a = await ctx.api.raw(member, 'GET', '/api/me');
      const b = await ctx.api.raw(member, 'GET', '/api/me');
      ctx.check({
        id: '10.8',
        name: 'Two requests with no client-supplied id get two different generated ids',
        expected: 200,
        res: b,
        extra: {
          ok: !!a.requestId && !!b.requestId && a.requestId !== b.requestId,
          detail: `a=${JSON.stringify(a.requestId)} b=${JSON.stringify(b.requestId)}`,
        },
        explanation: 'Each request gets its own fresh id; it is never a fixed or reused value.',
      });
    },
  },
];
