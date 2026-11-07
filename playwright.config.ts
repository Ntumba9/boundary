import { defineConfig, devices } from '@playwright/test';

// Browser end-to-end tests (e2e/). Like the authorization runner, they run
// against a server you start yourself (npm run dev, or next start as in CI),
// and they reseed the local database first.
//
//   npm run test:e2e                                   # http://localhost:3000
//   BOUNDARY_BASE_URL=http://localhost:3300 npm run test:e2e

const baseURL = process.env.BOUNDARY_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // One shared database: run serially so tests can't interfere with each other.
  fullyParallel: false,
  workers: 1,
  // No retries: a flaky authorization test is a bug to fix, not to paper over.
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
