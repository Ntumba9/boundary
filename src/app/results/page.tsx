import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

// Renders the LATEST test-runner output from test-results.json (written by
// `npm run test:authz`). Server-rendered from the file on each request; nothing
// is hardcoded, and this page cannot trigger any command. To refresh, re-run the
// runner from a terminal and reload.
//
// The file contains only case names, status codes and one-line explanations
// (the runner never writes tokens, cookies, passwords or document bodies), so
// the page is viewable without logging in.

export const dynamic = 'force-dynamic';

const caseSchema = z.object({
  id: z.string(),
  group: z.string(),
  name: z.string(),
  expected: z.string(),
  actual: z.string(),
  result: z.enum(['PASS', 'FAIL']),
  explanation: z.string(),
  intentionalFailure: z.boolean().optional(),
});

const resultsSchema = z.object({
  generatedAt: z.string(),
  baseUrl: z.string(),
  mode: z.enum(['safe', 'unsafe-demo']),
  summary: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    intentionalFailures: z.number(),
    unexpectedFailures: z.number(),
  }),
  cases: z.array(caseSchema),
});

type Results = z.infer<typeof resultsSchema>;

async function loadResults(): Promise<{ results: Results | null; problem: string | null }> {
  const file = path.join(process.cwd(), 'test-results.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { results: null, problem: 'No test-results.json yet. Run `npm run test:authz` and reload this page.' };
  }
  try {
    const parsed = resultsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { results: null, problem: 'test-results.json is not in the expected format.' };
    return { results: parsed.data, problem: null };
  } catch {
    return { results: null, problem: 'test-results.json is not valid JSON.' };
  }
}

export default async function ResultsPage() {
  const { results, problem } = await loadResults();

  return (
    <div className="stack">
      <h1>Authorization test results</h1>
      <p className="muted">
        Latest output of the local test runner. Re-run with <code>npm run test:authz</code> (safe) or{' '}
        <code>npm run test:authz:unsafe</code> (unsafe demo) and reload.
      </p>

      {problem && <p className="card">{problem}</p>}

      {results && (
        <>
          {results.mode === 'unsafe-demo' && (
            <p className="banner danger">
              UNSAFE DEMO MODE run: the tenant filter was removed from the single-document GET. Failures marked
              &quot;intentional&quot; are the vulnerability being caught, which is the expected outcome.
            </p>
          )}
          <section className="card summary" data-testid="results-summary">
            <div><span className="muted">Mode</span><strong>{results.mode}</strong></div>
            <div><span className="muted">Passed</span><strong>{results.summary.passed}/{results.summary.total}</strong></div>
            <div><span className="muted">Failed</span><strong>{results.summary.failed}</strong></div>
            <div><span className="muted">Unexpected failures</span><strong>{results.summary.unexpectedFailures}</strong></div>
            <div><span className="muted">Run at (UTC)</span><strong>{results.generatedAt.replace('T', ' ').slice(0, 19)}</strong></div>
            <div><span className="muted">Target</span><strong>{results.baseUrl}</strong></div>
          </section>
          <div className="table-wrap card">
            <table className="results">
              <thead>
                <tr><th>#</th><th>Case</th><th>Expected</th><th>Actual</th><th>Result</th><th>Explanation</th></tr>
              </thead>
              <tbody>
                {results.cases.map((c) => (
                  <tr key={c.id} className={c.result === 'PASS' ? 'pass' : c.intentionalFailure ? 'intentional' : 'fail'}>
                    <td>{c.id}</td>
                    <td><div className="muted small">{c.group}</div>{c.name}</td>
                    <td><code>{c.expected}</code></td>
                    <td><code>{c.actual}</code></td>
                    <td>
                      <span className={`badge ${c.result === 'PASS' ? 'pass' : 'fail'}`}>{c.result}</span>
                      {c.intentionalFailure && <div className="small">intentional (unsafe demo)</div>}
                    </td>
                    <td>{c.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
