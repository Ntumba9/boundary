// Real-browser checks of the flows a user actually clicks through. They
// complement, not replace, the HTTP-level authorization runner (test-runner/):
// that proves the API policy exhaustively; these prove the UI is wired to it,
// that client-side JavaScript runs under the CSP, and that page-level
// authorization returns real 403/404 responses rather than hiding links.
import { expect, test, type Page } from '@playwright/test';
import { COMPANIES, DEMO_PASSWORD, DOCUMENTS, PROJECTS, USERS } from '../scripts/seed-data.ts';

async function signIn(page: Page, email: string, password: string = DEMO_PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signInAndWaitForDashboard(page: Page, email: string): Promise<void> {
  await signIn(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe('login', () => {
  test('admin signs in through the form and lands on their own dashboard', async ({ page }) => {
    await signInAndWaitForDashboard(page, USERS.acmeAdmin.email);
    await expect(page.getByTestId('company-name')).toHaveText(COMPANIES.acme.name);
    await expect(page.getByTestId('role')).toHaveText('admin');
    await expect(page.getByRole('link', { name: 'Admin', exact: true })).toBeVisible();

    // Positive control: the admin panel really opens for an admin.
    const res = await page.goto('/admin');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('cell', { name: USERS.acmeMember.email })).toBeVisible();
  });

  test('wrong password shows a generic error and creates no session', async ({ page }) => {
    await signIn(page, USERS.acmeAdmin.email, 'not-the-password');
    // Scoped to the form: Next's route announcer is also role="alert".
    await expect(page.getByTestId('login-form').getByRole('alert')).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('role and tenant boundaries', () => {
  test('member dashboard shows own company and role, and no admin entry point', async ({ page }) => {
    await signInAndWaitForDashboard(page, USERS.globexMember.email);
    await expect(page.getByTestId('company-name')).toHaveText(COMPANIES.globex.name);
    await expect(page.getByTestId('role')).toHaveText('member');
    await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
    await expect(page.getByText(COMPANIES.acme.name)).toHaveCount(0);
  });

  test('member opening /admin directly gets a real HTTP 403 page', async ({ page }) => {
    await signInAndWaitForDashboard(page, USERS.acmeMember.email);
    const res = await page.goto('/admin');
    expect(res?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: '403 - Forbidden' })).toBeVisible();
    // The user list must not have been rendered behind the error.
    await expect(page.getByText(USERS.acmeAdmin.email)).toHaveCount(0);
  });

  test("another company's document URL is a 404 and leaks no content", async ({ page }) => {
    await signInAndWaitForDashboard(page, USERS.globexMember.email);
    const target = DOCUMENTS.acmeSkatesSpec;
    const res = await page.goto(`/documents/${target.id}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: '404 - Not found' })).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(target.title);
    expect(html).not.toContain('CONFIDENTIAL (Acme)');
  });

  test("another company's project URL is a 404; own project lists only own documents", async ({ page }) => {
    await signInAndWaitForDashboard(page, USERS.globexMember.email);

    const foreign = await page.goto(`/projects/${PROJECTS.acmeRocketSkates.id}`);
    expect(foreign?.status()).toBe(404);

    await page.goto('/dashboard');
    await page.getByRole('link', { name: PROJECTS.globexDoomsday.name }).click();
    await expect(page.getByRole('heading', { name: PROJECTS.globexDoomsday.name })).toBeVisible();
    await expect(page.getByRole('link', { name: DOCUMENTS.globexDoomsdayPlan.title })).toBeVisible();
    for (const d of Object.values(DOCUMENTS).filter((doc) => doc.companyId === COMPANIES.acme.id)) {
      await expect(page.getByText(d.title, { exact: true })).toHaveCount(0);
    }
  });
});

test.describe('content security policy', () => {
  test('pages carry a nonce-based CSP and the app runs without violations', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });

    const res = await page.goto('/login');
    const csp = res?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");

    // Exercise client-side code under the policy: the login form, client-side
    // navigation, and a client component (the document editor).
    await signInAndWaitForDashboard(page, USERS.acmeMember.email);
    await page.getByRole('link', { name: PROJECTS.acmeRocketSkates.name }).click();
    await page.getByRole('link', { name: DOCUMENTS.acmeSkatesBudget.title }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    expect(violations).toEqual([]);
  });
});
