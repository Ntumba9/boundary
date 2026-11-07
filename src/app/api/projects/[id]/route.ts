import { authed, json, parseJson } from '@/lib/api';
import { deleteProject, renameProject, requireProject } from '@/lib/services/projects';
import { projectSchema } from '@/lib/validation';

type Params = { id: string };

export const GET = authed<Params>(async ({ auth, params }) => json(await requireProject(auth, params.id)));

export const PATCH = authed<Params>(async ({ req, auth, params }) => {
  const input = await parseJson(req, projectSchema);
  return json(await renameProject(auth, params.id, { name: input.name }));
});

export const DELETE = authed<Params>(async ({ auth, params }) => {
  await deleteProject(auth, params.id);
  return json({ ok: true });
});
