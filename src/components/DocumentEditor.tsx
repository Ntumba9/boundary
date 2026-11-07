'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/client/api';

interface Props {
  id: string;
  projectId: string;
  initialTitle: string;
  initialBody: string;
}

// Shown only when the server says canEdit. That is a UX hint, not the control:
// the PATCH/DELETE handlers re-check ownership/admin on every request.
export function DocumentEditor({ id, projectId, initialTitle, initialBody }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await api('PATCH', `/api/documents/${id}`, { title, body });
    setBusy(false);
    if (!res.ok) {
      setError(`${res.status}: ${res.error}`);
      return;
    }
    setMessage('Saved');
    router.refresh();
  }

  async function onDelete() {
    if (!window.confirm('Delete this document?')) return;
    setBusy(true);
    const res = await api('DELETE', `/api/documents/${id}`);
    setBusy(false);
    if (!res.ok) {
      setError(`${res.status}: ${res.error}`);
      return;
    }
    router.replace(`/projects/${projectId}`);
    router.refresh();
  }

  return (
    <form className="card form" onSubmit={onSave}>
      <h3>Edit</h3>
      <label>
        Title
        <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Body
        <textarea rows={8} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="ok">{message}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>Save</button>
        <button type="button" className="danger" disabled={busy} onClick={onDelete}>Delete</button>
      </div>
    </form>
  );
}
