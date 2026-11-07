import { authed, json, parseJson } from '@/lib/api';
import { setUserActive } from '@/lib/services/users';
import { setActiveSchema } from '@/lib/validation';

type Params = { id: string };

export const PUT = authed<Params>(async ({ req, auth, params }) => {
  const input = await parseJson(req, setActiveSchema);
  return json(await setUserActive(auth, params.id, input.isActive));
});
