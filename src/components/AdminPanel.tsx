'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/client/api';

interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'member';
  isActive: boolean;
}

interface AdminProject {
  id: string;
  name: string;
  documentCount: number;
}

interface Props {
  currentUserId: string;
  users: AdminUser[];
  projects: AdminProject[];
}

export function AdminPanel({ currentUserId, users, projects }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newProject, setNewProject] = useState('');

  async function run(fn: () => ReturnType<typeof api>, onOk?: () => void) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      setError(`${res.status}: ${res.error}`);
      return;
    }
    onOk?.();
    router.refresh();
  }

  function onCreateUser(e: FormEvent) {
    e.preventDefault();
    void run(
      () => api('POST', '/api/admin/users', { email: newEmail, password: newPassword }),
      () => {
        setNewEmail('');
        setNewPassword('');
      },
    );
  }

  function onCreateProject(e: FormEvent) {
    e.preventDefault();
    void run(() => api('POST', '/api/projects', { name: newProject }), () => setNewProject(''));
  }

  return (
    <div className="stack">
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card">
        <h2>Users</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === currentUserId;
                return (
                  <tr key={u.id}>
                    <td>{u.email}{self && ' (you)'}</td>
                    <td><span className={`badge ${u.role}`}>{u.role}</span></td>
                    <td>{u.isActive ? 'active' : <span className="muted">deactivated</span>}</td>
                    <td className="actions">
                      {self ? (
                        <span className="muted">-</span>
                      ) : (
                        <>
                          <button type="button" disabled={busy} onClick={() => run(() => api('PUT', `/api/admin/users/${u.id}/role`, { role: u.role === 'admin' ? 'member' : 'admin' }))}>
                            {u.role === 'admin' ? 'Make member' : 'Make admin'}
                          </button>
                          <button type="button" className={u.isActive ? 'danger' : ''} disabled={busy} onClick={() => run(() => api('PUT', `/api/admin/users/${u.id}/active`, { isActive: !u.isActive }))}>
                            {u.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <form className="form inline-form" onSubmit={onCreateUser}>
          <h3>Create demo user (starts as member)</h3>
          <label>
            Email
            <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </label>
          <label>
            Password (min 12 chars)
            <input type="password" required minLength={12} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>Create user</button>
        </form>
      </section>

      <section className="card">
        <h2>Projects</h2>
        <ul className="list">
          {projects.map((p) => (
            <li key={p.id} className="row spread">
              <span>{p.name} <span className="muted">({p.documentCount} docs)</span></span>
              <button type="button" className="danger" disabled={busy} onClick={() => {
                if (window.confirm(`Delete project "${p.name}" and all its documents?`)) {
                  void run(() => api('DELETE', `/api/projects/${p.id}`));
                }
              }}>Delete</button>
            </li>
          ))}
        </ul>
        <form className="form inline-form" onSubmit={onCreateProject}>
          <label>
            New project name
            <input required maxLength={100} value={newProject} onChange={(e) => setNewProject(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>Create project</button>
        </form>
      </section>
    </div>
  );
}
