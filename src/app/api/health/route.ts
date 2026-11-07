import { json, publicRoute } from '@/lib/api';
import { query } from '@/lib/db';
import { isUnsafeDemoEnabled } from '@/lib/unsafe-demo';

// Used by CI and the test runner to confirm the server actually started and can
// reach the database, and to report whether unsafe demo mode is active.
export const GET = publicRoute(async (req) => {
  await query('SELECT 1');
  return json({
    ok: true,
    db: true,
    unsafeDemoMode: isUnsafeDemoEnabled(process.env, req.headers.get('host')),
  });
});
