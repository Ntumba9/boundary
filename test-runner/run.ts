// BOUNDARY authorization test runner.
//
// Usage:
//   npm run test:authz                         # safe mode, expects ALL cases to pass
//   npm run test:authz:unsafe                  # server must be in unsafe demo mode; expects case 1.1 to fail
//   node test-runner/run.ts --base-url http://localhost:3300
//
// Flags:
//   --base-url <url>     target (default BOUNDARY_BASE_URL or http://localhost:3000)
//   --unsafe-demo        assert the server IS in unsafe demo mode
//   --i-am-authorized    required (with an allowlist entry in config.ts) for non-local targets
//   --no-reset           skip DB reseeding (required for non-local targets; DB-level cases are skipped)
//
// Exit codes: 0 = every case passed, 1 = at least one case failed,
//             2 = configuration / startup error (server down, wrong mode, refused target).
//
// Output: console table + test-results.json at the repo root (rendered at /results).
// Neither ever contains tokens, cookies, passwords or document bodies.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoundaryHttpAdapter, type ApiResult, type Session } from './adapter.ts';
import { GROUPS, UNSAFE_TARGET_CASE_ID, type CaseResult, type GroupContext, type Mode } from './cases.ts';
import { checkTarget, DEFAULT_BASE_URL } from './config.ts';
import { DEMO_PASSWORD, resetFixtures } from './fixtures.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RESULTS_FILE = path.join(repoRoot, 'test-results.json');

interface Args {
  baseUrl: string;
  unsafeDemo: boolean;
  iAmAuthorized: boolean;
  noReset: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baseUrl: process.env.BOUNDARY_BASE_URL || DEFAULT_BASE_URL,
    unsafeDemo: false,
    iAmAuthorized: false,
    noReset: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base-url') args.baseUrl = argv[++i] ?? '';
    else if (a === '--unsafe-demo') args.unsafeDemo = true;
    else if (a === '--i-am-authorized') args.iAmAuthorized = true;
    else if (a === '--no-reset') args.noReset = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function fail(msg: string): never {
  console.error(`\n[runner] ERROR: ${msg}\n`);
  process.exit(2);
}

function banner(lines: string[]): void {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  console.log('\n' + '#'.repeat(width));
  for (const l of lines) console.log(`# ${l.padEnd(width - 4)} #`);
  console.log('#'.repeat(width) + '\n');
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    fail((e as Error).message);
  }

  const target = checkTarget(args.baseUrl, args.iAmAuthorized);
  if (!target.ok) fail(target.reason);
  if (!target.isLocal && !args.noReset) {
    fail('Non-local targets cannot be reset by this runner. Pass --no-reset (DB-level cases will be skipped).');
  }
  const api = new BoundaryHttpAdapter(target.url);

  // 1. The server must actually be up and healthy. A crash must never be
  //    mistaken for "the vulnerability test failed as expected".
  let health: ApiResult<{ ok: boolean; unsafeDemoMode: boolean }>;
  try {
    health = await api.health();
  } catch (e) {
    fail(`Server not reachable at ${target.url.origin} (${(e as Error).message}). Start it first.`);
  }
  if (health.status !== 200 || health.body?.ok !== true) {
    fail(`Health check failed (status ${health.status}). Is the database migrated and reachable?`);
  }
  const serverUnsafe = health.body.unsafeDemoMode === true;
  if (args.unsafeDemo && !serverUnsafe) {
    fail('--unsafe-demo was passed but the server reports unsafe demo mode OFF. Start it with `npm run dev:unsafe`.');
  }
  if (!args.unsafeDemo && serverUnsafe) {
    fail('Server reports unsafe demo mode ON. Re-run with --unsafe-demo (npm run test:authz:unsafe), or restart the server normally.');
  }
  const mode: Mode = serverUnsafe ? 'unsafe-demo' : 'safe';

  if (mode === 'unsafe-demo') {
    banner([
      'UNSAFE DEMO MODE DETECTED',
      `Case ${UNSAFE_TARGET_CASE_ID} (cross-tenant read by id) is EXPECTED to FAIL.`,
      'That failure is the runner catching the intentional vulnerability.',
      'All other cases must still pass.',
    ]);
  }

  console.log(`[runner] target ${target.url.origin}  mode=${mode}  reset=${args.noReset ? 'off' : 'on'}\n`);

  const results: CaseResult[] = [];

  for (const group of GROUPS) {
    if (!args.noReset) await resetFixtures();
    console.log(`== Group ${group.id}: ${group.title}`);

    const ctx: GroupContext = {
      api,
      mode,
      dbAccess: !args.noReset,
      check({ id, name, expected, res, explanation, extra }) {
        const exp = Array.isArray(expected) ? expected : [expected];
        const status = typeof res === 'number' ? res : res.status;
        const statusOk = exp.includes(status);
        const extraOk = extra ? extra.ok : true;
        const pass = statusOk && extraOk;
        const actual = statusOk && !extraOk ? `${status} (${extra?.detail})` : String(status);
        const intentional = !pass && mode === 'unsafe-demo' && id === UNSAFE_TARGET_CASE_ID;
        const r: CaseResult = {
          id,
          group: `${group.id}. ${group.title}`,
          name,
          expected: exp.join(' or '),
          actual,
          result: pass ? 'PASS' : 'FAIL',
          explanation,
          ...(intentional ? { intentionalFailure: true } : {}),
        };
        results.push(r);
        const tag = pass ? 'PASS' : intentional ? 'FAIL (intentional, unsafe demo)' : 'FAIL';
        console.log(`  [${tag}] ${id} ${name}\n         expected ${r.expected}, actual ${r.actual} - ${explanation}`);
        return pass;
      },
      async login(label: string, email: string, password: string = DEMO_PASSWORD): Promise<Session> {
        const res = await api.login(label, email, password);
        if (!res.session) throw new Error(`setup: login as ${label} failed (status ${res.status})`);
        return res.session;
      },
    };

    try {
      await group.run(ctx);
    } catch (e) {
      const msg = (e as Error).message.replace(/[a-f0-9]{64}/gi, '[REDACTED]');
      results.push({
        id: `${group.id}.setup`,
        group: `${group.id}. ${group.title}`,
        name: 'Group setup / execution',
        expected: 'no error',
        actual: 'error',
        result: 'FAIL',
        explanation: msg,
      });
      console.log(`  [FAIL] ${group.id}.setup ${msg}`);
    }
    console.log('');
  }

  // Leave the DB in a clean seeded state for interactive use after a run.
  if (!args.noReset) await resetFixtures();

  const failed = results.filter((r) => r.result === 'FAIL');
  const intentional = failed.filter((r) => r.intentionalFailure);
  const summary = {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    intentionalFailures: intentional.length,
    unexpectedFailures: failed.length - intentional.length,
  };

  await writeFile(
    RESULTS_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: target.url.origin, mode, summary, cases: results }, null, 2) + '\n',
    'utf8',
  );

  console.log(`[runner] ${summary.passed}/${summary.total} passed, ${summary.failed} failed (${summary.intentionalFailures} intentional). Results: test-results.json`);

  if (mode === 'unsafe-demo') {
    const onlyTarget = failed.length === 1 && failed[0].id === UNSAFE_TARGET_CASE_ID;
    banner(
      onlyTarget
        ? [
            'UNSAFE DEMO RESULT: vulnerability DETECTED as designed.',
            `Exactly one case failed (${UNSAFE_TARGET_CASE_ID}): a Globex user read an Acme document by id.`,
            'Every other control still held. Restart with `npm run dev` to fix.',
          ]
        : ['UNSAFE DEMO RESULT: UNEXPECTED outcome.', `Failures: ${failed.map((f) => f.id).join(', ') || 'none'}`],
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  fail(msg.replace(/[a-f0-9]{64}/gi, '[REDACTED]'));
});
