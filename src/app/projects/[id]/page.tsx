import Link from 'next/link';
import { NewDocumentForm } from '@/components/NewDocumentForm';
import { pageCall, requirePageAuth } from '@/lib/auth/page';
import { pageFromSearchParam } from '@/lib/pagination';
import { listDocumentsInProject } from '@/lib/services/documents';
import { requireProject } from '@/lib/services/projects';

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const { id } = await params;
  const { cursor } = await searchParams;
  const auth = await requirePageAuth();
  const project = await pageCall(() => requireProject(auth, id)); // 404 if other company
  const page = pageFromSearchParam(cursor);
  const { items: documents, nextCursor } = await pageCall(() => listDocumentsInProject(auth, id, page));

  return (
    <div className="stack">
      <p><Link href="/dashboard">&larr; Projects</Link></p>
      <h1>{project.name}</h1>
      <div className="two-col">
        <section className="card">
          <h2>Documents <span className="muted small">({project.documentCount})</span></h2>
          {documents.length === 0 ? (
            <p className="muted">No documents yet.</p>
          ) : (
            <ul className="list">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link href={`/documents/${d.id}`}>{d.title}</Link>
                  <div className="muted small">
                    owner {d.ownerEmail}{d.canEdit ? ' - you can edit' : ' - read only'}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {(page.after || nextCursor) && (
            <nav className="row spread small" aria-label="Pagination">
              {page.after ? <Link href={`/projects/${project.id}`}>&larr; First page</Link> : <span />}
              {nextCursor && <Link href={`/projects/${project.id}?cursor=${encodeURIComponent(nextCursor)}`}>Next page &rarr;</Link>}
            </nav>
          )}
        </section>
        <NewDocumentForm projectId={project.id} />
      </div>
    </div>
  );
}
