// Lightweight UI smoke tests: fetch server-rendered HTML and string-match.
// No browser, no JavaScript execution. They prove pages render, auth redirects
// work, and page-level authorization uses the same 403/404 policy as the API.
//
// Real-browser tests live in e2e/ (Playwright); see README "Expanding the UI tests".
//
// Usage: npm run test:smoke [-- --base-url http://localhost:3300]
import { BoundaryHttpAdapter, type Session } from './adapter.ts';
import { checkTarget, DEFAULT_BASE_URL } from './config.ts';
import { DEMO_PASSWORD, DOCUMENTS, PROJECTS, resetFixtures, USERS } from './fixtures.ts';
import { safeFetch } from './safe-http.ts';

const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--base-url');
const baseUrl = urlIdx >= 0 ? argv[urlIdx + 1] : process.env.BOUNDARY_BASE_URL || DEFAULT_BASE_URL;
const target = checkTarget(baseUrl, false);
if (!target.ok || !target.isLocal) {
  console.error(`smoke: refusing target: ${target.ok ? 'smoke tests are local-only' : target.reason}`);
  process.exit(2);
}
const origin = target.url.origin;
const api = new BoundaryHttpAdapter(target.url);

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} - ${detail}`);
}

async function page(path: string, s?: Session): Promise<{ status: number; html: string; location: string | null }> {
  const headers: Record<string, string> = { accept: 'text/html' };
  if (s) headers.cookie = [...s.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await safeFetch(origin, origin + path, { headers, noFollow: true });
  return { status: res.status, html: await res.text(), location: res.headers.get('location') };
}

async function login(email: string): Promise<Session> {
  const r = await api.login(email, email, DEMO_PASSWORD);
  if (!r.session) throw new Error(`login failed for ${email} (status ${r.status})`);
  return r.session;
}

async function main(): Promise<void> {
  const health = await api.health().catch(() => null);
  if (!health || health.status !== 200) {
    console.error(`smoke: server not healthy at ${origin}`);
    process.exit(2);
  }
  await resetFixtures();
  console.log(`== UI smoke tests against ${origin}`);

  const loginPage = await page('/login');
  check('Login page renders', loginPage.status === 200 && loginPage.html.includes('data-testid="login-form"'), `status ${loginPage.status}`);

  const anonDash = await page('/dashboard');
  check(
    'Anonymous /dashboard redirects to /login',
    anonDash.status >= 300 && anonDash.status < 400 && (anonDash.location ?? '').includes('/login'),
    `status ${anonDash.status}`,
  );

  for (const u of Object.values(USERS)) {
    const s = await login(u.email);
    const dash = await page('/dashboard', s);
    const company = u.companyId === USERS.acmeAdmin.companyId ? 'Acme Corp' : 'Globex Inc';
    const other = company === 'Acme Corp' ? 'Globex Inc' : 'Acme Corp';
    check(
      `Dashboard for ${u.role} of ${company}`,
      dash.status === 200 && dash.html.includes(company) && dash.html.includes(`>${u.role}<`) && !dash.html.includes(other),
      `status ${dash.status}, shows own company and role only`,
    );
  }

  const acmeMember = await login(USERS.acmeMember.email);
  const acmeAdmin = await login(USERS.acmeAdmin.email);

  const adminAsMember = await page('/admin', acmeMember);
  check('Member opening /admin gets 403 page', adminAsMember.status === 403, `status ${adminAsMember.status}`);

  const adminAsAdmin = await page('/admin', acmeAdmin);
  check('Admin opening /admin sees user list', adminAsAdmin.status === 200 && adminAsAdmin.html.includes(USERS.acmeMember.email), `status ${adminAsAdmin.status}`);

  const project = await page(`/projects/${PROJECTS.acmeRocketSkates.id}`, acmeMember);
  check('Project page lists its documents', project.status === 200 && project.html.includes(DOCUMENTS.acmeSkatesSpec.title), `status ${project.status}`);

  const foreignProject = await page(`/projects/${PROJECTS.globexDoomsday.id}`, acmeMember);
  check('Foreign project page is 404', foreignProject.status === 404, `status ${foreignProject.status}`);

  const foreignDoc = await page(`/documents/${DOCUMENTS.globexDoomsdayPlan.id}`, acmeMember);
  check(
    'Foreign document page is 404 and leaks nothing',
    foreignDoc.status === 404 && !foreignDoc.html.includes('CONFIDENTIAL (Globex)'),
    `status ${foreignDoc.status}`,
  );

  const ownDoc = await page(`/documents/${DOCUMENTS.acmeSkatesBudget.id}`, acmeMember);
  check('Own document page shows editor for owner', ownDoc.status === 200 && ownDoc.html.includes('>Save<'), `status ${ownDoc.status}`);

  const othersDoc = await page(`/documents/${DOCUMENTS.acmeSkatesSpec.id}`, acmeMember);
  check('Non-owned document is read-only for member', othersDoc.status === 200 && !othersDoc.html.includes('>Save<'), `status ${othersDoc.status}`);

  const results = await page('/results');
  check('Results page renders', results.status === 200 && results.html.includes('Authorization test results'), `status ${results.status}`);

  await resetFixtures();
  console.log(`\nsmoke: ${failures === 0 ? 'all passed' : `${failures} failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(`smoke: error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
