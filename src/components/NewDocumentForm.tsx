'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/client/api';

export function NewDocumentForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Only title and body are sent. Owner and company are set by the server from the session.
    const res = await api('POST', `/api/projects/${projectId}/documents`, { title, body });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setTitle('');
    setBody('');
    router.refresh();
  }

  return (
    <form className="card form" onSubmit={onSubmit}>
      <h3>New document</h3>
      <label>
        Title
        <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Body
        <textarea rows={4} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>Create</button>
    </form>
  );
}
