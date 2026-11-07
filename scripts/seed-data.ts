// Fixed seed data. IDs are hardcoded UUIDs so the test runner can reference
// known rows directly and runs are reproducible.
//
// DEMO PASSWORD: every seeded account uses DEMO_PASSWORD below. It is a
// published demo value. Never reuse it for a real account.
//
// Note: fixed/guessable IDs are deliberate here. Unguessable IDs are NOT an
// access-control mechanism; the tenant filter in SQL is. The unsafe demo mode
// shows exactly what happens when that filter is missing.

export const DEMO_PASSWORD = 'Password123!';

export const COMPANIES = {
  acme: { id: 'a0000000-0000-4000-8000-000000000001', name: 'Acme Corp' },
  globex: { id: 'b0000000-0000-4000-8000-000000000001', name: 'Globex Inc' },
} as const;

export type SeedRole = 'admin' | 'member';

export const USERS = {
  acmeAdmin: {
    id: 'a0000000-0000-4000-8000-0000000000a1',
    companyId: COMPANIES.acme.id,
    email: 'admin@acme.example',
    role: 'admin' as SeedRole,
  },
  acmeMember: {
    id: 'a0000000-0000-4000-8000-0000000000a2',
    companyId: COMPANIES.acme.id,
    email: 'member@acme.example',
    role: 'member' as SeedRole,
  },
  globexAdmin: {
    id: 'b0000000-0000-4000-8000-0000000000b1',
    companyId: COMPANIES.globex.id,
    email: 'admin@globex.example',
    role: 'admin' as SeedRole,
  },
  globexMember: {
    id: 'b0000000-0000-4000-8000-0000000000b2',
    companyId: COMPANIES.globex.id,
    email: 'member@globex.example',
    role: 'member' as SeedRole,
  },
} as const;

export const PROJECTS = {
  acmeRocketSkates: { id: 'a0000000-0000-4000-8000-000000000101', companyId: COMPANIES.acme.id, name: 'Rocket Skates' },
  acmeAnvil: { id: 'a0000000-0000-4000-8000-000000000102', companyId: COMPANIES.acme.id, name: 'Anvil Redesign' },
  acmePortableHoles: { id: 'a0000000-0000-4000-8000-000000000103', companyId: COMPANIES.acme.id, name: 'Portable Holes' },
  globexDoomsday: { id: 'b0000000-0000-4000-8000-000000000101', companyId: COMPANIES.globex.id, name: 'Doomsday Device' },
  globexHammock: { id: 'b0000000-0000-4000-8000-000000000102', companyId: COMPANIES.globex.id, name: 'Hammock District' },
} as const;

interface SeedDocument {
  id: string;
  projectId: string;
  companyId: string;
  ownerUserId: string;
  title: string;
  body: string;
}

function doc(
  id: string,
  project: { id: string; companyId: string },
  owner: { id: string },
  title: string,
  body: string,
): SeedDocument {
  return { id, projectId: project.id, companyId: project.companyId, ownerUserId: owner.id, title, body };
}

const P = PROJECTS;
const U = USERS;

export const DOCUMENTS = {
  // Acme
  acmeSkatesSpec: doc('a0000000-0000-4000-8000-000000000201', P.acmeRocketSkates, U.acmeAdmin, 'Skates spec v2', 'CONFIDENTIAL (Acme): thrust tolerances and braking failure analysis.'),
  acmeSkatesBudget: doc('a0000000-0000-4000-8000-000000000202', P.acmeRocketSkates, U.acmeMember, 'Skates budget', 'CONFIDENTIAL (Acme): Q3 budget of 1.2M for rocket fuel.'),
  acmeSkatesNotes: doc('a0000000-0000-4000-8000-000000000203', P.acmeRocketSkates, U.acmeMember, 'Field test notes', 'CONFIDENTIAL (Acme): test pilot reports from the canyon site.'),
  acmeAnvilBrief: doc('a0000000-0000-4000-8000-000000000204', P.acmeAnvil, U.acmeAdmin, 'Anvil design brief', 'CONFIDENTIAL (Acme): new lightweight alloy supplier list.'),
  acmeAnvilQa: doc('a0000000-0000-4000-8000-000000000205', P.acmeAnvil, U.acmeMember, 'Anvil QA checklist', 'CONFIDENTIAL (Acme): drop-test acceptance criteria.'),
  acmeHolesPatent: doc('a0000000-0000-4000-8000-000000000206', P.acmePortableHoles, U.acmeAdmin, 'Patent draft', 'CONFIDENTIAL (Acme): unfiled patent claims for portable holes.'),
  acmeHolesRisks: doc('a0000000-0000-4000-8000-000000000207', P.acmePortableHoles, U.acmeMember, 'Risk register', 'CONFIDENTIAL (Acme): known failure modes when folded twice.'),
  // Globex
  globexDoomsdayPlan: doc('b0000000-0000-4000-8000-000000000201', P.globexDoomsday, U.globexAdmin, 'Device roadmap', 'CONFIDENTIAL (Globex): phase 3 launch timeline.'),
  globexDoomsdayVendors: doc('b0000000-0000-4000-8000-000000000202', P.globexDoomsday, U.globexMember, 'Vendor shortlist', 'CONFIDENTIAL (Globex): laser vendor pricing.'),
  globexDoomsdayOps: doc('b0000000-0000-4000-8000-000000000203', P.globexDoomsday, U.globexMember, 'Ops runbook', 'CONFIDENTIAL (Globex): volcano lair maintenance schedule.'),
  globexHammockSite: doc('b0000000-0000-4000-8000-000000000204', P.globexHammock, U.globexAdmin, 'Site plan', 'CONFIDENTIAL (Globex): hammock district zoning notes.'),
  globexHammockHiring: doc('b0000000-0000-4000-8000-000000000205', P.globexHammock, U.globexMember, 'Hiring plan', 'CONFIDENTIAL (Globex): headcount for the hammock team.'),
} as const;
