import { execFileSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// Refuse non-local targets (same rule as test-runner/smoke.ts), then reseed the
// local database so every run starts from the fixed demo dataset. The seed
// script itself also refuses a non-local DATABASE_URL.
export default function globalSetup(config: FullConfig): void {
  const baseURL = config.projects[0]?.use.baseURL;
  const host = baseURL ? new URL(baseURL).hostname : '';
  if (!LOOPBACK.has(host)) {
    throw new Error(`e2e: refusing non-local target "${baseURL}". These tests reseed the database.`);
  }
  execFileSync(process.execPath, ['--env-file-if-exists=.env', 'scripts/seed.ts'], { stdio: 'inherit' });
}
