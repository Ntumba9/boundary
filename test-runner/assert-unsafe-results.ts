// CI check for the unsafe-demo run. Reads test-results.json and asserts:
//   (a) the run was actually in unsafe-demo mode (server came up healthy and
//       reported the mode; the runner refuses to write results otherwise),
//   (b) exactly the expected case failed, and it is marked intentional,
//   (c) every other case passed,
//   (d) the file is fresh (written in the last 15 minutes), so a stale file
//       from an earlier run can't satisfy the check.
// Exit 0 if all hold, 1 otherwise.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNSAFE_TARGET_CASE_ID } from './cases.ts';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results.json');

interface Results {
  generatedAt: string;
  mode: string;
  summary: { total: number; failed: number };
  cases: Array<{ id: string; result: string; intentionalFailure?: boolean }>;
}

const problems: string[] = [];
let data: Results;
try {
  data = JSON.parse(await readFile(file, 'utf8')) as Results;
} catch (e) {
  console.error(`assert-unsafe: cannot read ${file}: ${(e as Error).message}`);
  process.exit(1);
}

const ageMs = Date.now() - Date.parse(data.generatedAt);
if (!(ageMs >= 0 && ageMs < 15 * 60 * 1000)) problems.push(`results are stale (generatedAt ${data.generatedAt})`);
if (data.mode !== 'unsafe-demo') problems.push(`mode is "${data.mode}", expected "unsafe-demo"`);
if (data.cases.length < 10) problems.push(`only ${data.cases.length} cases recorded; the run looks incomplete`);
if (data.cases.some((c) => c.id.endsWith('.setup'))) problems.push('a group setup step failed');

const failed = data.cases.filter((c) => c.result !== 'PASS');
const target = data.cases.find((c) => c.id === UNSAFE_TARGET_CASE_ID);
if (!target) problems.push(`case ${UNSAFE_TARGET_CASE_ID} missing`);
else if (target.result !== 'FAIL') problems.push(`case ${UNSAFE_TARGET_CASE_ID} PASSED: the unsafe toggle did not take effect or the runner missed it`);
else if (!target.intentionalFailure) problems.push(`case ${UNSAFE_TARGET_CASE_ID} failed but is not marked intentional`);

const others = failed.filter((c) => c.id !== UNSAFE_TARGET_CASE_ID);
if (others.length > 0) problems.push(`unexpected failures: ${others.map((c) => c.id).join(', ')}`);

if (problems.length) {
  console.error('assert-unsafe: FAILED');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `assert-unsafe: OK. Exactly case ${UNSAFE_TARGET_CASE_ID} failed (intentional); ${data.cases.length - 1} other cases passed.`,
);
