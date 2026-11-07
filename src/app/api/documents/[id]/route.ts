import { authed, json, parseJson } from '@/lib/api';
import { deleteDocument, getDocumentById, updateDocument } from '@/lib/services/documents';
import { isUnsafeDemoEnabled } from '@/lib/unsafe-demo';
import { updateDocumentSchema } from '@/lib/validation';

type Params = { id: string };

// GET is the single endpoint affected by the unsafe demo toggle.
export const GET = authed<Params>(async ({ req, auth, params }) => {
  const unsafeDemo = isUnsafeDemoEnabled(process.env, req.headers.get('host'));
  return json(await getDocumentById(auth, params.id, { unsafeDemo }));
});

export const PATCH = authed<Params>(async ({ req, auth, params }) => {
  const input = await parseJson(req, updateDocumentSchema);
  return json(await updateDocument(auth, params.id, { title: input.title, body: input.body }));
});

export const DELETE = authed<Params>(async ({ auth, params }) => {
  await deleteDocument(auth, params.id);
  return json({ ok: true });
});
