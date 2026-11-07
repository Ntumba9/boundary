import { authed, json, parseJson } from '@/lib/api';
import { parsePageQuery } from '@/lib/pagination';
import { createUser, listUsers } from '@/lib/services/users';
import { createUserSchema } from '@/lib/validation';

// GET ?limit=&cursor=  ->  { items: UserDto[], nextCursor: string | null }
export const GET = authed(async ({ req, auth }) => json(await listUsers(auth, parsePageQuery(req.nextUrl.searchParams))));

export const POST = authed(async ({ req, auth }) => {
  const input = await parseJson(req, createUserSchema);
  return json(await createUser(auth, { email: input.email, password: input.password }), 201);
});
