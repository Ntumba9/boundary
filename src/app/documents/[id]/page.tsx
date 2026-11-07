import Link from 'next/link';
import { headers } from 'next/headers';
import { DocumentEditor } from '@/components/DocumentEditor';
import { pageCall, requirePageAuth } from '@/lib/auth/page';
import { getDocumentById } from '@/lib/services/documents';
import { isUnsafeDemoEnabled } from '@/lib/unsafe-demo';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requirePageAuth();
  // Same code path as GET /api/documents/:id, including the demo toggle.
  const unsafeDemo = isUnsafeDemoEnabled(process.env, (await headers()).get('host'));
  const doc = await pageCall(() => getDocumentById(auth, id, { unsafeDemo }));
  const crossTenant = doc.companyId !== auth.companyId;

  return (
    <div className="stack">
      <p><Link href={`/projects/${doc.projectId}`}>&larr; Back to project</Link></p>
      {crossTenant && (
        <p className="banner danger" role="alert">
          UNSAFE DEMO MODE: you are viewing another company&apos;s document. This is the intentional
          vulnerability; in safe mode this page returns 404.
        </p>
      )}
      <article className="card">
        <h1>{doc.title}</h1>
        <p className="muted small">
          Owner {doc.ownerEmail} - updated {new Date(doc.updatedAt).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
        </p>
        <pre className="doc-body">{doc.body}</pre>
      </article>
      {doc.canEdit && !crossTenant ? (
        <DocumentEditor id={doc.id} projectId={doc.projectId} initialTitle={doc.title} initialBody={doc.body} />
      ) : (
        <p className="muted">
          {crossTenant ? 'Editing is still blocked: write paths are always tenant-scoped.' : 'Read only: only the owner or an admin can edit this document.'}
        </p>
      )}
    </div>
  );
}
