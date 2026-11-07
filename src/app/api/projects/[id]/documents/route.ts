import { authed, json, parseJson } from '@/lib/api';
import { parsePageQuery } from '@/lib/pagination';
import { createDocument, listDocumentsInProject } from '@/lib/services/documents';
import { createDocumentSchema } from '@/lib/validation';

type Params = { id: string };

// GET ?limit=&cursor=  ->  { items: DocumentWithPermissions[], nextCursor: string | null }
export const GET = authed<Params>(async ({ req, auth, params }) =>
  json(await listDocumentsInProject(auth, params.id, parsePageQuery(req.nextUrl.searchParams))),
);

export const POST = authed<Params>(async ({ req, auth, params }) => {
  // Whitelisted fields only. company_id / owner_user_id are set from `auth` in the service.
  const input = await parseJson(req, createDocumentSchema);
  return json(await createDocument(auth, params.id, { title: input.title, body: input.body }), 201);
});
