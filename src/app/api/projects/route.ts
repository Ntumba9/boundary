import { authed, json, parseJson } from '@/lib/api';
import { createProject, listProjects } from '@/lib/services/projects';
import { projectSchema } from '@/lib/validation';

export const GET = authed(async ({ auth }) => json(await listProjects(auth)));

export const POST = authed(async ({ req, auth }) => {
  const input = await parseJson(req, projectSchema);
  return json(await createProject(auth, { name: input.name }), 201);
});
