import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { getPageAuth } from '@/lib/auth/page';

export default async function LoginPage() {
  if (await getPageAuth()) redirect('/dashboard');
  return (
    <div className="narrow stack">
      <h1>Sign in to BOUNDARY</h1>
      <LoginForm />
      <details className="card muted">
        <summary>Demo accounts</summary>
        <p>
          Seeded demo users: <code>admin@acme.example</code>, <code>member@acme.example</code>,{' '}
          <code>admin@globex.example</code>, <code>member@globex.example</code>. The shared demo password is
          documented in the README and <code>scripts/seed-data.ts</code>. Never reuse it anywhere real.
        </p>
      </details>
    </div>
  );
}
