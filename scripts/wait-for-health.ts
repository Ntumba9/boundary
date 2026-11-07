// Polls GET /api/health until the server is up and the DB is reachable, then
// optionally asserts the reported unsafe-demo state. Used by CI so a server
// that crashed on startup can never be mistaken for "the test failed as expected".
//
//   node scripts/wait-for-health.ts http://localhost:3000 [--expect-unsafe=true|false] [--timeout=90]
const [, , baseUrl = 'http://localhost:3000', ...rest] = process.argv;
const expectArg = rest.find((a) => a.startsWith('--expect-unsafe='));
const expectUnsafe = expectArg ? expectArg.split('=')[1] === 'true' : undefined;
const timeoutSec = Number(rest.find((a) => a.startsWith('--timeout='))?.split('=')[1] ?? 90);

const deadline = Date.now() + timeoutSec * 1000;
let last = 'no response';
while (Date.now() < deadline) {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; unsafeDemoMode?: boolean } | null;
    if (res.status === 200 && body?.ok === true) {
      if (expectUnsafe !== undefined && body.unsafeDemoMode !== expectUnsafe) {
        console.error(`health: server up but unsafeDemoMode=${String(body.unsafeDemoMode)}, expected ${expectUnsafe}`);
        process.exit(1);
      }
      console.log(`health: ok (unsafeDemoMode=${String(body.unsafeDemoMode)})`);
      process.exit(0);
    }
    last = `status ${res.status}`;
  } catch (e) {
    last = (e as Error).message;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error(`health: server at ${baseUrl} not healthy after ${timeoutSec}s (${last})`);
process.exit(1);
