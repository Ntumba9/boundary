// Starts `next dev` with the two unsafe-demo env vars set for THIS PROCESS ONLY.
// Nothing is written to .env, so a normal `npm run dev` is always safe.
//
//   npm run dev:unsafe              # port 3000
//   npm run dev:unsafe -- -p 3300   # extra args are passed to `next dev`
//
// The app additionally refuses to enable the mode when NODE_ENV=production or
// when the request Host is not localhost (see src/lib/unsafe-demo.ts).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to start unsafe demo mode with NODE_ENV=production.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

console.warn(
  '\n*** BOUNDARY UNSAFE DEMO MODE ***\n' +
    'The tenant filter is removed from GET /api/documents/:id (getDocumentById).\n' +
    'Local demonstration only. Stop this server and run `npm run dev` to restore safe behaviour.\n',
);

const child = spawn(process.execPath, [nextBin, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    BOUNDARY_UNSAFE_DEMO_MODE: '1',
    BOUNDARY_ALLOW_UNSAFE: 'local-demo-only',
  },
});

const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
process.on('SIGINT', forward('SIGINT'));
process.on('SIGTERM', forward('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
