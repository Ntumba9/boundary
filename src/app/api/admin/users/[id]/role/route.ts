import { authed, json, parseJson } from '@/lib/api';
import { changeRole } from '@/lib/services/users';
import { changeRoleSchema } from '@/lib/validation';

type Params = { id: string };

export const PUT = authed<Params>(async ({ req, auth, params }) => {
  const input = await parseJson(req, changeRoleSchema);
  return json(await changeRole(auth, params.id, input.role));
});
