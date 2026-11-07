'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/client/api';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api('POST', '/api/auth/login', { email, password });
    if (res.ok) {
      // refresh() makes the server re-render the layout with the new session cookie.
      router.replace('/dashboard');
      router.refresh();
      return;
    }
    setBusy(false);
    setError(res.error);
  }

  return (
    <form className="card form" onSubmit={onSubmit} data-testid="login-form">
      <label>
        Email
        <input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
    </form>
  );
}
