import Link from 'next/link';
import { AdminPanel } from '@/components/AdminPanel';
import { pageCall, requirePageAuth } from '@/lib/auth/page';
import { pageFromSearchParam } from '@/lib/pagination';
import { listProjects } from '@/lib/services/projects';
import { listUsers } from '@/lib/services/users';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const auth = await requirePageAuth();
  const page = pageFromSearchParam((await searchParams).cursor);
  // listUsers enforces admin-only and throws 403 for members; pageCall turns
  // that into Next's forbidden() page with a real 403 status.
  const { items: users, nextCursor } = await pageCall(() => listUsers(auth, page));
  const projects = await listProjects(auth);

  return (
    <div className="stack">
      <h1>Admin - {auth.companyName}</h1>
      <p className="muted">All actions apply only to {auth.companyName}. The server enforces this on every request.</p>
      <AdminPanel
        currentUserId={auth.userId}
        users={users.map((u) => ({ id: u.id, email: u.email, role: u.role, isActive: u.isActive }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name, documentCount: p.documentCount }))}
      />
      {(page.after || nextCursor) && (
        <nav className="row spread small" aria-label="User pagination">
          {page.after ? <Link href="/admin">&larr; First page of users</Link> : <span />}
          {nextCursor && <Link href={`/admin?cursor=${encodeURIComponent(nextCursor)}`}>Next page of users &rarr;</Link>}
        </nav>
      )}
    </div>
  );
}
