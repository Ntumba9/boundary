import Link from 'next/link';
import { requirePageAuth } from '@/lib/auth/page';
import { canManageProjects } from '@/lib/permissions';
import { listProjects } from '@/lib/services/projects';

export default async function DashboardPage() {
  const auth = await requirePageAuth();
  const projects = await listProjects(auth);

  return (
    <div className="stack">
      <section className="card">
        <h1 data-testid="company-name">{auth.companyName}</h1>
        <p>
          Signed in as <strong>{auth.email}</strong> with role{' '}
          <span className={`badge ${auth.role}`} data-testid="role">{auth.role}</span>
        </p>
        {canManageProjects(auth) && (
          <p><Link href="/admin">Open admin panel</Link></p>
        )}
      </section>

      <section>
        <h2>Projects</h2>
        {projects.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <ul className="grid">
            {projects.map((p) => (
              <li key={p.id} className="card">
                <Link href={`/projects/${p.id}`}><strong>{p.name}</strong></Link>
                <p className="muted">{p.documentCount} document{p.documentCount === 1 ? '' : 's'}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
